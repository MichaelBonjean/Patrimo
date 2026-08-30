import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * Migration technique one-shot: attribue `owner_id` aux enregistrements orphelins (sans owner_id)
 * en se basant EXCLUSIVEMENT sur `created_by` (créateur réel). Ne s'approprie JAMAIS les orphelins
 * d'un autre utilisateur: sans créateur connu, l'enregistrement reste orphelin.
 *
 * Accès: RÉSERVÉ SUPER-ADMIN (role === 'admin'). Refus explicite de tout autre utilisateur.
 * Intention explicite requise: { confirm: true } pour exécuter.
 * Journalisation: lanceur, objets affectés, ancienne/nouvelle valeur, date.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    // 1) Authentification obligatoire.
    const user = await base44.auth.me();
    if (!user) {
      console.warn('[migrateOwnerIds] REFUS: aucun utilisateur authentifié');
      return Response.json({ error: "Authentification requise." }, { status: 401 });
    }

    // 2) Outil technique réservé super-administrateur. Refus explicite de tout autre rôle.
    if (user.role !== 'admin') {
      console.warn(`[migrateOwnerIds] REFUS: utilisateur non-admin ${user.email} (role=${user.role})`);
      return Response.json(
        { error: "Accès refusé : cette migration technique est reserved aux administrateurs." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));

    // 3) Intention explicite obligatoire: évite toute exécution accidentelle (même par un admin).
    if (!body || body.confirm !== true) {
      return Response.json(
        { error: "Confirmation requise : passez { confirm: true } pour exécuter la migration." },
        { status: 400 }
      );
    }

    const svc = base44.asServiceRole;
    const runDate = new Date().toISOString();
    const by = user.email;
    const entities = [
      'Property', 'Lot', 'Transaction', 'BankImport', 'BankRule',
      'Holder', 'PropertyHolder', 'SCITemplate'
    ];
    const counts = {};
    const skipped = [];
    const audit = [];

    for (const entityName of entities) {
      const all = await svc.entities[entityName].list();
      // Uniquement les enregistrements réellement orphelins (sans owner_id).
      const toMigrate = all.filter(r => !r.owner_id);
      counts[entityName] = { total: all.length, orphans: toMigrate.length, migrated: 0, skipped: 0 };

      for (const record of toMigrate) {
        // Attribution fiable : owner_id = créateur de l'enregistrement (created_by = email).
        // On NE s'approprie JAMAIS les orphelins d'un autre utilisateur : sans créateur connu,
        // l'enregistrement reste orphelin plutôt que d'être attribué au lanceur.
        const realOwner = record.created_by;
        if (!realOwner || !String(realOwner).includes('@')) {
          counts[entityName].skipped++;
          skipped.push({ entity: entityName, id: record.id, reason: 'no_created_by' });
          continue;
        }
        const oldVal = record.owner_id ?? null;
        await svc.entities[entityName].update(record.id, { owner_id: realOwner });
        counts[entityName].migrated++;
        audit.push({
          entity: entityName,
          id: record.id,
          old_owner_id: oldVal,
          new_owner_id: realOwner,
          by,
          date: runDate
        });
      }
    }

    const totalMigrated = audit.length;
    console.log(`[migrateOwnerIds] run by=${by} date=${runDate} migrated=${totalMigrated}`);
    console.log(`[migrateOwnerIds] audit (first 50):`, JSON.stringify(audit.slice(0, 50)));

    return Response.json({
      success: true,
      admin: by,
      run_date: runDate,
      counts,
      skipped,
      audit_count: totalMigrated,
      audit_sample: audit.slice(0, 100)
    });
  } catch (error) {
    console.error('[migrateOwnerIds] erreur:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
}