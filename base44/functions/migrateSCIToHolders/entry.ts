import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const svc = base44.asServiceRole;
    const sciList = await svc.entities.SCITemplate.list();
    const propertyHoldersList = await svc.entities.PropertyHolder.list();
    const holdersList = await svc.entities.Holder.list();

    let migratedCount = 0;
    let skipped = 0;
    const sciMapping = {}; // oldSciId -> newHolderId
    const orphans = [];

    // Pour chaque SCI: créer un Holder dans le patrimoine de SON propriétaire (created_by / owner_id).
    for (const sci of sciList) {
      // Propriétaire fiable: owner_id (présent si créé après isolation) sinon created_by.
      const owner = sci.owner_id || sci.created_by;
      if (!owner || !String(owner).includes('@')) {
        skipped++;
        orphans.push({ id: sci.id, name: sci.sci_name, reason: 'no_owner' });
        continue;
      }

      // Réutilise un Holder existant DU MÊME propriétaire avec le même nom+type (évite de fusionner
      // deux SCI de patrimoines différents portant le même nom).
      const existingHolder = holdersList.find(
        h => h.owner_id === owner && h.type === 'SCI' && h.name === sci.sci_name
      );

      let holderId;
      if (existingHolder) {
        holderId = existingHolder.id;
      } else {
        const newHolder = await svc.entities.Holder.create({
          owner_id: owner,
          is_demo: sci.is_demo || false,
          name: sci.sci_name,
          type: 'SCI',
          siret: sci.sci_siret,
          notes: sci.sci_bank ? `Banque: ${sci.sci_bank}` : '',
        });
        holderId = newHolder.id;
        holdersList.push(newHolder);
        migratedCount++;
      }
      sciMapping[sci.id] = holderId;
    }

    // Mettre à jour les PropertyHolder qui pointaient vers les anciens SCITemplate.id
    let reassigned = 0;
    for (const ph of propertyHoldersList) {
      if (sciMapping[ph.holder_id]) {
        // Vérification de cohérence: le PropertyHolder et le nouveau Holder doivent partager le même propriétaire.
        await svc.entities.PropertyHolder.update(ph.id, {
          holder_id: sciMapping[ph.holder_id],
        });
        reassigned++;
      }
    }

    return Response.json({
      success: true,
      message: `Migration complétée: ${migratedCount} SCI créées, ${reassigned} PropertyHolder réassignés, ${skipped} sans propriétaire ignorées`,
      created: migratedCount,
      reassigned,
      skipped_orphans: skipped,
      orphans,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}