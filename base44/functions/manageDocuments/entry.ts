import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * Coffre documentaire structuré.
 *
 *  - op 'list'    : retourne tous les documents du bailleur + dictionnaires de
 *                   noms des entités liées (pour l'affichage et la recherche).
 *  - op 'extract' : upload d'un fichier -> extraction IA (InvokeLLM) proposant
 *                   type, bien, lot, montant, date, fournisseur. Si la confiance
 *                   est faible (< CONFIDENCE_THRESHOLD), le document est créé en
 *                   statut 'pending_review' (validation humaine requise).
 *  - op 'save'    : met à jour un document (édition manuelle / correction IA).
 *  - op 'validate': passe un document 'pending_review' -> 'valide'.
 *  - op 'delete'  : supprime un document.
 *
 * L'IA ne modifie jamais des données existantes : elle ne fait que proposer,
 * stockée dans ai_proposal. L'application à un bien/lot/etc n'est effective qu'après
 * validation (automatique si confiance élevée, manuelle sinon).
 */

const CONFIDENCE_THRESHOLD = 0.7;
const TYPE_VALUES = [
  'bail', 'etat_des_lieux', 'quittance', 'facture', 'acte', 'taxe_fonciere',
  'dpe', 'assurance', 'pret', 'ag_copropriete', 'releve_bancaire', 'autre',
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function norm(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function pickType(v) {
  const t = norm(v);
  if (!t) return 'autre';
  const found = TYPE_VALUES.find((x) => x === t || x.replace('_', '') === t.replace('_', ''));
  return found || 'autre';
}

function confidence(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const owner = user.email;
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const op = body.op || 'list';

    if (op === 'list') {
      const [docs, properties, lots, leases, holders, transactions, impayes] = await Promise.all([
        svc.entities.Document.filter({ owner_id: owner }),
        svc.entities.Property.filter({ owner_id: owner }),
        svc.entities.Lot.filter({ owner_id: owner }),
        svc.entities.Lease.filter({ owner_id: owner }),
        svc.entities.Holder.filter({ owner_id: owner }),
        svc.entities.Transaction.filter({ owner_id: owner }),
        svc.entities.Impaye.filter({ owner_id: owner }),
      ]);
      const linkNames = {
        property: Object.fromEntries(properties.map((p) => [p.id, p.name || ''])),
        lot: Object.fromEntries(lots.map((l) => [l.id, l.designation || ''])),
        lease: Object.fromEntries(leases.map((l) => [l.id, `${l.tenants?.[0]?.name || 'Bail'} · ${l.date_start || ''}`])),
        holder: Object.fromEntries(holders.map((h) => [h.id, h.name || ''])),
        transaction: Object.fromEntries(transactions.map((t) => [t.id, `${t.category_label || t.category || ''} ${t.amount || 0}€`])),
        impaye: Object.fromEntries(impayes.map((i) => [i.id, `${i.tenant_name || ''} · ${i.period || ''}`])),
      };
      return Response.json({ documents: docs, linkNames });
    }

    if (op === 'extract') {
      const file_url = norm(body.file_url);
      const filename = norm(body.filename) || 'document';
      if (!file_url) return Response.json({ error: 'file_url requis' }, { status: 400 });

      // Catalogue compact des entités du bailleur pour aider l'IA à rattacher.
      const [properties, lots, leases, holders, transactions, impayes] = await Promise.all([
        svc.entities.Property.filter({ owner_id: owner }),
        svc.entities.Lot.filter({ owner_id: owner }),
        svc.entities.Lease.filter({ owner_id: owner }),
        svc.entities.Holder.filter({ owner_id: owner }),
        svc.entities.Transaction.filter({ owner_id: owner }),
        svc.entities.Impaye.filter({ owner_id: owner }),
      ]);

      const tenants: { id: string; name: string }[] = [];
      const leaseTenants = new Set<string>();
      for (const l of leases) {
        for (const t of l.tenants || []) {
          const key = `${l.id}|${t.id || t.name}`;
          if (!leaseTenants.has(key)) {
            leaseTenants.add(key);
            tenants.push({ id: `lease:${l.id}:${t.id || t.name}`, name: t.name || '' });
          }
        }
      }
      for (const l of lots) {
        for (const t of l.tenants || []) {
          tenants.push({ id: `lot:${l.id}:${t.id || t.name}`, name: t.name || '' });
        }
      }

      const catalog = [
        'BIENS : ' + properties.map((p) => `${p.id}=${JSON.stringify(p.name || '')} (${p.city || ''})`).join(', '),
        'LOTS : ' + lots.map((l) => `${l.id}=${JSON.stringify(l.designation || '')} (bien ${l.property_id})`).join(', '),
        'BAILS : ' + leases.map((l) => `${l.id}=bail ${l.date_start || ''} (lot ${l.lot_id}, bien ${l.property_id})`).join(', '),
        'TENANTS : ' + tenants.map((t) => `${t.id}=${JSON.stringify(t.name)}`).join(', '),
        'DETENTEURS : ' + holders.map((h) => `${h.id}=${JSON.stringify(h.name || '')}`).join(', '),
        'TRANSACTIONS : ' + transactions.slice(0, 50).map((t) => `${t.id}=${JSON.stringify(t.category_label || t.category || '')} ${t.amount || 0}€ ${t.year || ''}-${t.month || ''}`).join(', '),
        'IMPAYES : ' + impayes.slice(0, 50).map((i) => `${i.id}=impaye ${i.tenant_name || ''} ${i.period || ''}`).join(', '),
        'TYPES VALIDES : ' + TYPE_VALUES.join(', '),
      ].join('\n');

      const prompt = `Tu es un assistant qui analyse un document immobilier pour le ranger dans un coffre documentaire.
À partir du document fourni (et du nom de fichier), propose des métadonnées.
Réponds UNIQUEMENT avec le JSON du schéma demandé.

Catalogue du bailleur (identifiants à réutiliser si tu reconnais une correspondance, sinon null) :
${catalog}

Règles :
- type : choisis parmi les TYPES VALIDES.
- *_id : identifiant EXACT du catalogue si tu es confiant, sinon null.
- tenant_id : utilise l'identifiant du catalogue TENANTS si reconnu, sinon null.
- loan_id : si type='pret', mets 'loan:<property_id>' du bien concerné si identifié, sinon null.
- document_date / expiration_date : format YYYY-MM-DD si lisible, sinon null. expiration_date seulement si le document a une échéance (assurance, DPE, bail…).
- amount : montant numérique si présent (facture, taxe…), sinon null.
- supplier : nom de l'émetteur / fournisseur si lisible.
- confidence : nombre entre 0 et 1 reflétant ta confiance globale sur l'extraction.
- rationale : une courte justification en français.`;

      let ai: any = null;
      try {
        ai = await base44.integrations.Core.InvokeLLM({
          prompt,
          file_urls: [file_url],
          response_json_schema: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              title: { type: 'string' },
              document_date: { type: 'string' },
              expiration_date: { type: 'string' },
              supplier: { type: 'string' },
              amount: { type: 'number' },
              property_id: { type: 'string' },
              lot_id: { type: 'string' },
              lease_id: { type: 'string' },
              tenant_id: { type: 'string' },
              holder_id: { type: 'string' },
              transaction_id: { type: 'string' },
              impaye_id: { type: 'string' },
              loan_id: { type: 'string' },
              confidence: { type: 'number' },
              rationale: { type: 'string' },
            },
          },
        });
      } catch (e) {
        // En cas d'échec IA, on crée un document basique à valider manuellement.
        ai = null;
      }

      const conf = ai ? confidence(ai.confidence) : 0;
      const lowConfidence = !ai || conf < CONFIDENCE_THRESHOLD;

      // Résolution du nom de locataire si tenant_id pointe vers un bail/lot.
      let tenant_name = '';
      const tid = norm(ai?.tenant_id) || null;
      if (tid) {
        const [kind, refId, tRef] = tid.split(':');
        if (kind === 'lease' && leases.find((l) => l.id === refId)) {
          const t = leases.find((l) => l.id === refId)?.tenants?.find((x) => (x.id || x.name) === tRef);
          tenant_name = t?.name || tRef || '';
        } else if (kind === 'lot' && lots.find((l) => l.id === refId)) {
          const t = lots.find((l) => l.id === refId)?.tenants?.find((x) => (x.id || x.name) === tRef);
          tenant_name = t?.name || tRef || '';
        }
      }

      const doc = {
        owner_id: owner,
        is_demo: false,
        title: norm(ai?.title) || filename.replace(/\.[^.]+$/, ''),
        file_url,
        filename,
        mime_type: norm(body.mime_type) || '',
        type: pickType(ai?.type),
        property_id: norm(ai?.property_id) || null,
        lot_id: norm(ai?.lot_id) || null,
        lease_id: norm(ai?.lease_id) || null,
        tenant_id: tid,
        tenant_name,
        holder_id: norm(ai?.holder_id) || null,
        transaction_id: norm(ai?.transaction_id) || null,
        impaye_id: norm(ai?.impaye_id) || null,
        loan_id: norm(ai?.loan_id) || null,
        document_date: norm(ai?.document_date) || null,
        expiration_date: norm(ai?.expiration_date) || null,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
        source: norm(body.source) || 'upload',
        version: norm(body.version) || '',
        supplier: norm(ai?.supplier) || '',
        amount: ai && !Number.isNaN(Number(ai.amount)) ? Number(ai.amount) : null,
        commentaire: '',
        ai_proposal: ai
          ? {
              type: pickType(ai.type),
              title: norm(ai.title) || '',
              document_date: norm(ai.document_date),
              expiration_date: norm(ai.expiration_date),
              supplier: norm(ai.supplier) || '',
              amount: ai.amount == null ? null : Number(ai.amount),
              property_id: norm(ai.property_id),
              lot_id: norm(ai.lot_id),
              lease_id: norm(ai.lease_id),
              tenant_id: tid,
              holder_id: norm(ai.holder_id),
              transaction_id: norm(ai.transaction_id),
              impaye_id: norm(ai.impaye_id),
              loan_id: norm(ai.loan_id),
              confidence: conf,
              rationale: norm(ai.rationale) || '',
            }
          : null,
        ai_validated: !lowConfidence,
        status: lowConfidence ? 'pending_review' : 'valide',
        actor: owner,
      };
      const record = await svc.entities.Document.create(doc);
      return Response.json({ record, ai: doc.ai_proposal, low_confidence: lowConfidence });
    }

    const getDoc = async (id) => {
      const recs = await svc.entities.Document.filter({ owner_id: owner });
      return recs.find((r) => r.id === id) || null;
    };

    if (op === 'save' || op === 'validate') {
      if (!body.id) return Response.json({ error: 'id requis' }, { status: 400 });
      const rec = await getDoc(body.id);
      if (!rec) return Response.json({ error: 'Document introuvable' }, { status: 404 });

      const patch: any = {};
      const f = (k, v) => {
        if (v !== undefined && v !== null) patch[k] = v;
      };
      if (op === 'save') {
        patch.title = norm(body.title) || rec.title;
        patch.type = pickType(body.type);
        f('property_id', norm(body.property_id));
        f('lot_id', norm(body.lot_id));
        f('lease_id', norm(body.lease_id));
        f('tenant_id', norm(body.tenant_id));
        f('tenant_name', norm(body.tenant_name));
        f('holder_id', norm(body.holder_id));
        f('transaction_id', norm(body.transaction_id));
        f('impaye_id', norm(body.impaye_id));
        f('loan_id', norm(body.loan_id));
        f('document_date', norm(body.document_date));
        f('expiration_date', norm(body.expiration_date));
        f('supplier', norm(body.supplier));
        f('version', norm(body.version));
        f('commentaire', norm(body.commentaire));
        f('mime_type', norm(body.mime_type));
        if (body.tags !== undefined) patch.tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
        if (body.amount !== undefined) {
          const a = body.amount === null || body.amount === '' ? null : Number(body.amount);
          patch.amount = Number.isNaN(a) ? null : a;
        }
        if (body.source !== undefined) patch.source = norm(body.source) || rec.source;
      }
      if (op === 'validate' || (op === 'save' && body.set_valide)) {
        patch.status = 'valide';
        patch.ai_validated = true;
        patch.actor = owner;
      }
      if (Object.keys(patch).length === 0) return Response.json({ record: rec });
      const updated = await svc.entities.Document.update(rec.id, patch);
      return Response.json({ record: updated });
    }

    if (op === 'delete') {
      if (!body.id) return Response.json({ error: 'id requis' }, { status: 400 });
      const rec = await getDoc(body.id);
      if (!rec) return Response.json({ error: 'Document introuvable' }, { status: 404 });
      await svc.entities.Document.delete(rec.id);
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'op inconnu' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}