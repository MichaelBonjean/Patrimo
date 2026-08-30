import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { detectCycles, findOrphanMembers } from '../../shared/ownership.ts';

/**
 * migrateHoldersModel — migration technique ONE-SHOT (réservée super-admin).
 * Transforme l'ancien modèle plat `Holder.members[]` en enregistrements canoniques `HolderMember`,
 * permettant la détention imbriquée (Personne → SCI A → SCI B → Bien).
 *
 * Idempotent: ne recrée pas un couple (parent, member) déjà existant.
 * N'attribute JAMAIS les données à l'utilisateur qui lance la fonction: le owner_id est celui du
 * Holder source (owner_id ou created_by), préservant l'isolation multi-utilisateurs.
 * Journalise: lanceur, objets affectés, owner, date.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Authentification requise.' }, { status: 401 });
    if (user.role !== 'admin') {
      console.warn(`[migrateHoldersModel] REFUS: ${user.email} (role=${user.role})`);
      return Response.json({ error: 'Réservé administrateur.' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    if (!body || body.confirm !== true) {
      return Response.json({ error: 'Confirmation requise: { confirm: true }.' }, { status: 400 });
    }

    const svc = base44.asServiceRole;
    const runDate = new Date().toISOString();
    const by = user.email;

    const [holders, existingMembers, propertyHolders] = await Promise.all([
      svc.entities.Holder.list(),
      svc.entities.HolderMember.list(),
      svc.entities.PropertyHolder.list()
    ]);

    const holderById = new Map(holders.map(h => [h.id, h]));
    const existingPair = new Set(existingMembers.map(m => `${m.parent_holder_id}|${m.member_holder_id}`));
    const audit: any[] = [];
    let created = 0, skippedExisting = 0, skippedOrphan = 0, skippedNoOwner = 0;

    for (const h of holders) {
      const legacyMembers: any[] = (h as any).members || [];
      if (!Array.isArray(legacyMembers) || legacyMembers.length === 0) continue;
      const owner = h.owner_id || h.created_by;
      if (!owner || !String(owner).includes('@')) { skippedNoOwner++; continue; }
      for (const m of legacyMembers) {
        if (!m?.holder_id || !holderById.has(m.holder_id)) { skippedOrphan++; continue; }
        const key = `${h.id}|${m.holder_id}`;
        if (existingPair.has(key)) { skippedExisting++; continue; }
        try {
          await svc.entities.HolderMember.create({
            owner_id: owner,
            is_demo: !!h.is_demo,
            parent_holder_id: h.id,
            member_holder_id: m.holder_id,
            share_percent: m.share_percent
          });
          created++;
          audit.push({ parent: h.id, member: m.holder_id, share_percent: m.share_percent, owner, by, date: runDate });
        } catch (e) {
          // journalisé, on continue
          console.warn(`[migrateHoldersModel] échec création ${key}: ${e.message}`);
        }
      }
    }

    // Rechargement pour les contrôles post-migration.
    const [membersAfter, holdersAfter] = await Promise.all([
      svc.entities.HolderMember.list(),
      svc.entities.Holder.list()
    ]);
    const cycles = detectCycles(membersAfter);
    const orphanMembers = findOrphanMembers(membersAfter, holdersAfter);
    const orphanPropertyHolders = propertyHolders
      .filter(ph => !holdersAfter.find(hh => hh.id === ph.holder_id))
      .map(ph => ({ id: ph.id, holder_id: ph.holder_id, property_id: ph.property_id }));

    console.log(`[migrateHoldersModel] by=${by} date=${runDate} migrated=${created} audit=${audit.length}`);

    return Response.json({
      success: true,
      admin: by,
      run_date: runDate,
      migrated: created,
      skipped_existing: skippedExisting,
      skipped_orphan: skippedOrphan,
      skipped_no_owner: skippedNoOwner,
      audit_count: audit.length,
      audit_sample: audit.slice(0, 100),
      cycles,
      orphan_members: orphanMembers,
      orphan_property_holders: orphanPropertyHolders
    });
  } catch (error) {
    console.error('[migrateHoldersModel] erreur:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
}