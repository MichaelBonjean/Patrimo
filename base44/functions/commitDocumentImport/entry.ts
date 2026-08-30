import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { waitUntil } from 'base44:runtime';
import { logAction } from '../../shared/audit.ts';
import { sendPush } from '../../shared/notify.ts';
import { buildCommitPlan } from '../../shared/documentCommit.ts';
import { resolveAndValidatePlan, applyResolvedRefs } from '../../shared/commitEngine.ts';
import { generateRentDuesForLease } from '../../shared/rentDueEngine.ts';

/**
 * commitDocumentImport — valide un import IA et crée/met à jour les entités
 * cibles (Property, Lot, Lease, Holder, Transaction, Document) à partir des
 * données extraites + validées par l'utilisateur.
 *
 * Payload : { document_import_id, validated_data?, target_entities: [{entity, action, data, id?}] }
 *
 *  - isolation multi-tenant (RLS owner_id + vérif explicite)
 *  - création/mise à jour atomique des entités cibles
 *  - created_from_entities[] alimenté avec les refs
 *  - status = 'committed'
 *  - AuditLog { action: 'document_ai_commit', … }
 *  - trigger milestone 'first_ai_import' (unique par utilisateur)
 *  - push "N nouvelles fiches créées automatiquement ✨"
 */

const ALLOWED_ENTITIES = ['Property', 'Lot', 'Lease', 'Holder', 'HolderMember', 'PropertyHolder', 'Transaction', 'Document'];

// Mapping classification IA -> type de Document (coffre documentaire)
const CLASS_TO_DOC_TYPE: Record<string, string> = {
  bail_alur: 'bail',
  acte_vente_notarie: 'acte',
  offre_pret_bancaire: 'pret',
  tableau_amortissement: 'pret',
  releve_bancaire: 'releve_bancaire',
  diagnostic_technique: 'dpe',
  sci_statuts_kbis: 'ag_copropriete',
  quittance_loyer: 'quittance',
  autre: 'autre',
  unknown: 'autre',
};

function entityLabel(type: string, r: any): string {
  if (!r) return type;
  if (type === 'Property') return r.name || 'Bien';
  if (type === 'Lot') return r.designation || 'Lot';
  if (type === 'Lease') return (r.tenants?.[0]?.name || 'Bail') + ' · ' + (r.date_start || '');
  if (type === 'Holder') return r.name || 'Détenteur';
  if (type === 'Transaction') return (r.category_label || r.category || '') + ' ' + (r.amount || 0) + '€';
  if (type === 'Document') return r.title || r.filename || 'Document';
  return type;
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const id = body?.document_import_id;
    if (!id) return Response.json({ error: 'document_import_id requis' }, { status: 400 });

    const svc = base44.asServiceRole;
    const mine = await svc.entities.DocumentImport.filter({ owner_id: user.email });
    const rec = (mine || []).find((r: any) => r.id === id);
    if (!rec) return Response.json({ error: 'Document introuvable' }, { status: 404 });
    if (rec.status === 'committed') return Response.json({ error: 'Document déjà validé' }, { status: 409 });

    // Two commit modes:
    //  1. explicit `target_entities` (manual override / review validated) — legacy path kept.
    //  2. `auto_propose: true` → le moteur documentCommit calcule le plan depuis le
    //     portefeuille existant ; seules les cibles non `needs_review` sont appliquées
    //     (les sensibles / incertaines sont différées en `errors` pour validation).
    let targets: any[] = Array.isArray(body.target_entities) ? body.target_entities : [];
    const validated: any = body.validated_data || rec.extracted_data || {};
    let plan: any = null;

    // Fetch du portefeuille existant (nécessaire au plan auto ET à la validation
    // d'intégrité des chaînes de détention Holder/HolderMember/PropertyHolder).
    const needsContext =
      body.auto_propose === true ||
      (Array.isArray(body.target_entities) &&
        body.target_entities.some((t: any) =>
          ['Holder', 'HolderMember', 'PropertyHolder', 'Property'].includes(t.entity)));
    let ctxHolders: any[] = [];
    let ctxMembers: any[] = [];
    let ctxProperties: any[] = [];
    let ctxLots: any[] = [];
    let ctxLeases: any[] = [];
    if (needsContext) {
      const [h, m, p, l, le] = await Promise.all([
        svc.entities.Holder.filter({ owner_id: user.email }).catch(() => []),
        svc.entities.HolderMember.filter({ owner_id: user.email }).catch(() => []),
        svc.entities.Property.filter({ owner_id: user.email }).catch(() => []),
        svc.entities.Lot.filter({ owner_id: user.email }).catch(() => []),
        svc.entities.Lease.filter({ owner_id: user.email }).catch(() => []),
      ]);
      ctxHolders = h || []; ctxMembers = m || []; ctxProperties = p || [];
      ctxLots = l || []; ctxLeases = le || [];
    }

    if (targets.length === 0 && body.auto_propose === true) {
      plan = buildCommitPlan({
        classification: rec.classification || 'unknown',
        extracted_data: validated,
        confidence_per_field: rec.confidence_per_field || {},
        classification_confidence: rec.classification_confidence || 0,
        context: {
          properties: ctxProperties, lots: ctxLots, leases: ctxLeases,
          holders: ctxHolders, members: ctxMembers,
        },
      });
      targets = plan.targets;
    }

    // Intégrité + ordonnancement des chaînes de détention (références temporelles
    // temp_id, pourcentages, boucles directes/indirectes, doublons, orphelins).
    // Les cibles bloquées sont retirées du lot exécuté → atomicité : jamais
    // « société créée mais associés perdus ».
    let orderedTargets: any[] = targets;
    let planErrors: any[] = [];
    let planWarnings: any[] = [];
    if (targets.length) {
      const v = resolveAndValidatePlan(targets, {
        owner_id: user.email,
        patrimony_id: rec.patrimony_id || user.email,
        holders: ctxHolders, members: ctxMembers, properties: ctxProperties,
      });
      orderedTargets = v.orderedTargets;
      planErrors = v.errors;
      planWarnings = v.warnings;
    }
    // X-ray de la décision (audit) — on garde le plan + la validation dans les détails d'audit.
    const planAudit = plan
      ? { auto_propose: true, needs_review: plan.needs_review, risk_notes: plan.risk_notes, validation_errors: planErrors, validation_warnings: planWarnings }
      : (planErrors.length ? { validation_errors: planErrors, validation_warnings: planWarnings } : null);

    const created: any[] = [];
    const updated: any[] = [];
    const errors: any[] = [...planErrors.map((e) => ({ entity: e.entity || 'validation', error: e.error, temp_id: e.temp_id }))];
    const lastCreatedIds: Record<string, string> = {};
    // Map temp_id -> id réel (résolution des références temporelles pendant la passe).
    const tempIdMap: Record<string, string> = {};
    // Map nom du détenteur -> id, fallback legacy pour résolution par nom.
    const createdHoldersByName: Record<string, string> = {};
    // Baux créés/mis à jour lors de la passe : on génère leurs échéances futures.
    const leaseRecords: any[] = [];

    for (const t of orderedTargets) {
      // Mode auto_propose : on n'applique pas les cibles nécessitant validation humaine.
      if (planAudit && t.needs_review && !body.confirm_reviewed) {
        errors.push({ entity: t.entity, error: 'validation utilisateur requise (champ sensible ou confiance insuffisante)' });
        continue;
      }
      const e = String(t?.entity || '');
      if (!ALLOWED_ENTITIES.includes(e)) {
        errors.push({ entity: e, error: 'entité non supportée' });
        continue;
      }
      const action = t.action === 'update' ? 'update' : 'create';
      // Résolution des références temporelles (temp_id -> id réel) AVANT la copie
      // de data : mutte t.data (parent_holder_id/member_holder_id/holder_id/property_id).
      applyResolvedRefs(t, tempIdMap, { holders: ctxHolders, properties: ctxProperties });
      const data = { ...(t.data || {}), owner_id: user.email, ...(validated && action === 'create' ? { _from_validated: true } : {}) };
      delete data._from_validated;
      try {

        // Fallbacks chaînés : Lot/Lease/PropertyHolder sans property_id héritent
        // du dernier Property créé ; Lease sans lot_id du dernier Lot.
        if (action === 'create' && (e === 'Lot' || e === 'Lease' || e === 'PropertyHolder' || e === 'HolderMember')) {
          if (!data.property_id && (e === 'Lot' || e === 'Lease' || e === 'PropertyHolder') && lastCreatedIds.Property)
            data.property_id = lastCreatedIds.Property;
          if (e === 'Lease' && !data.lot_id && lastCreatedIds.Lot) data.lot_id = lastCreatedIds.Lot;
          if (e === 'PropertyHolder') {
            // holder_ref déjà résolu par applyResolvedRefs ; fallback legacy par nom.
            if (!data.holder_id && data._holder_name && createdHoldersByName[data._holder_name])
              data.holder_id = createdHoldersByName[data._holder_name];
            delete data._holder_name;
            if (!data.holder_id) {
              errors.push({ entity: 'PropertyHolder', error: 'détenteur non résolu (création différée)' });
              continue;
            }
          }
          if (e === 'HolderMember') {
            // parent_ref/member_ref déjà résolus ; fallbacks legacy par nom.
            if (!data.parent_holder_id && data._await_parent_name && createdHoldersByName[data._await_parent_name])
              data.parent_holder_id = createdHoldersByName[data._await_parent_name];
            if (!data.member_holder_id && data._await_member_name && createdHoldersByName[data._await_member_name])
              data.member_holder_id = createdHoldersByName[data._await_member_name];
            delete data._await_parent_name;
            delete data._await_member_name;
            if (!data.parent_holder_id || !data.member_holder_id) {
              errors.push({ entity: 'HolderMember', error: 'parent ou member non résolu (création différée)' });
              continue;
            }
          }
        }
        if (action === 'create') {
          const r = await svc.entities[e].create(data);
          lastCreatedIds[e] = r.id;
          // temp_id -> id réel : alimente la map pour les dépendants de la passe.
          if (t.temp_id) tempIdMap[t.temp_id] = r.id;
          if (e === 'Holder' && r.name) createdHoldersByName[r.name] = r.id;
          if (e === 'Lease') leaseRecords.push(r);
          created.push({ type: e, id: r.id, label: entityLabel(e, r) });
        } else if (t.id) {
          const r = await svc.entities[e].update(t.id, data);
          if (e === 'Lease') leaseRecords.push(r);
          updated.push({ type: e, id: t.id, label: entityLabel(e, r) });
        } else {
          errors.push({ entity: e, error: 'id requis pour update' });
        }
      } catch (err: any) {
        errors.push({ entity: e, error: err?.message || 'échec' });
      }
    }

    // Création d'une fiche Document (coffre) pour le fichier original
    try {
      const docType = CLASS_TO_DOC_TYPE[rec.classification] || 'autre';
      const docRec = await svc.entities.Document.create({
        owner_id: user.email,
        is_demo: false,
        title: rec.file_name || 'Import IA',
        file_url: rec.file_url,
        filename: rec.file_name,
        mime_type: rec.mime_type || '',
        type: docType,
        source: 'import',
        ai_validated: true,
        status: 'valide',
        actor: user.email,
        // Lien au Property reconnu par le plan (ex : acte de vente) — le document
        // original reste rattaché au bien.
        property_id: plan?.document_meta?.property_id || undefined,
      });
      created.push({ type: 'Document', id: docRec.id, label: rec.file_name || 'Document' });
    } catch (err: any) {
      errors.push({ entity: 'Document', error: err?.message || 'échec création fiche document' });
    }

    // Génération des échéances futures (RentDue) des baux créés/mis à jour,
    // selon la logique partagée (idempotente, bail actif seulement).
    let rent_dues_created = 0;
    for (const lr of leaseRecords) {
      try {
        const rd = await generateRentDuesForLease(svc, lr, { forward_months: 3 });
        rent_dues_created += rd.created;
      } catch (err: any) {
        errors.push({ entity: 'RentDue', error: err?.message || 'génération échéances' });
      }
    }

    const createdFrom = [...created, ...updated];
    const updatedRec = await svc.entities.DocumentImport.update(rec.id, {
      status: 'committed',
      committed_at: new Date().toISOString(),
      committed_by: user.email,
      created_from_entities: createdFrom,
    });

    // Audit
    await logAction(svc, {
      patrimony_id: rec.patrimony_id || user.email,
      actor_email: user.email,
      actor_role: user.patrimony_role || 'OWNER',
      action: 'other',
      entity_type: 'DocumentImport',
      entity_id: rec.id,
      entity_label: rec.file_name || '',
      details: {
        action: 'document_ai_commit',
        target: rec.id,
        entities_created: created.length,
        entities_updated: updated.length,
        rent_dues_created,
        errors,
        // Corrections utilisateur champ par champ (ancienne → nouvelle valeur),
        // tracées pour l'audit et l'enrichissement futur des règles d'extraction.
        corrections: Array.isArray(body.field_corrections) ? body.field_corrections : [],
        ...(planAudit ? { plan: planAudit } : {}),
      },
    });

    // Milestone 'first_ai_import' (unique)
    try {
      const existing = await svc.entities.UserMilestone.filter({ owner_id: user.email, kind: 'first_ai_import' });
      if (!existing || existing.length === 0) {
        await svc.entities.UserMilestone.create({
          owner_id: user.email,
          kind: 'first_ai_import',
          first_time_at: new Date().toISOString(),
        });
      }
    } catch {
      /* non bloquant */
    }

    // Push de célébration
    if (created.length > 0) {
      waitUntil(
        sendPush(svc, user.id, `${created.length} nouvelle${created.length > 1 ? 's' : ''} fiche${created.length > 1 ? 's' : ''} créée${created.length > 1 ? 's' : ''} automatiquement ✨`, 'Voir mes biens', 'Voir', '/biens'),
      );
    }

    return Response.json({
      ok: true,
      record: updatedRec,
      entities_created: created,
      entities_updated: updated,
      rent_dues_created,
      errors,
      validation_warnings: planWarnings,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}