import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  computeLeaseStatus,
  isLeaseActiveAt,
  pickActiveLease,
  pickLeaseForPeriod,
  activeLeaseInfo,
  todayISO,
} from '../../shared/leaseResolve.ts';

function assert(cond: boolean, label: string, errs: string[]) {
  if (!cond) errs.push(`ÉCHEC: ${label}`);
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }
    const svc = base44.asServiceRole;
    const owner = user.email;
    const today = todayISO();

    // Création d'un bien + lot de test.
    const prop = await svc.entities.Property.create({
      owner_id: owner, is_demo: true, name: 'Immeuble-Test-Lease',
      category: 'Immeuble', holding_structure: 'En propre', tax_regime: 'Location nue (revenus fonciers)',
    });
    const lot = await svc.entities.Lot.create({
      owner_id: owner, is_demo: true, property_id: prop.id, designation: 'Lot-Test-Lease',
      typology: 'T2', surface: 50,
    });

    const ids: string[] = [];
    const make = async (data: any) => {
      const l = await svc.entities.Lease.create({ owner_id: owner, is_demo: true, property_id: prop.id, lot_id: lot.id, ...data });
      ids.push(l.id);
      return l;
    };

    const errs: string[] = [];
    const made: any = {};

    // 1. Bail passé.
    const past = await make({
      lease_type: 'Vide-Nu', date_start: '2023-01-01', date_end: '2023-12-31',
      tenants: [{ name: 'Ancien Locataire', entry_date: '2023-01-01', exit_date: '2023-12-31' }],
      rent_excluding_charges: 500, charges: 50, deposit: 500, status: 'termine',
    });
    assert(computeLeaseStatus(past, today) === 'termine', 'bail passé → status termine', errs);
    assert(isLeaseActiveAt(past, today) === false, 'bail passé non actif', errs);

    // 2. Bail futur.
    const future = await make({
      lease_type: 'Vide-Nu', date_start: '2027-01-01', date_end: '2029-12-31',
      tenants: [{ name: 'Futur Locataire', entry_date: '2027-01-01' }],
      rent_excluding_charges: 700, charges: 60, deposit: 700, status: 'futur',
    });
    assert(computeLeaseStatus(future, today) === 'futur', 'bail futur → status futur', errs);
    assert(isLeaseActiveAt(future, today) === false, 'bail futur non actif', errs);

    // 3. Bail actif + succession de locataires (nouveau bail après l'ancien).
    const active = await make({
      lease_type: 'Vide-Nu', date_start: '2024-03-01',
      tenants: [{ name: 'Locataire Actuel', entry_date: '2024-03-01', email: 'actuel@test.com' }],
      rent_excluding_charges: 650, charges: 55, deposit: 650, status: 'actif',
    });
    assert(computeLeaseStatus(active, today) === 'actif', 'bail actif → status actif', errs);
    assert(isLeaseActiveAt(active, today) === true, 'bail actif actif', errs);

    // Résolution: pickActiveLease doit renvoyer le bail actif (pas le passé ni le futur).
    const all = await svc.entities.Lease.filter({ lot_id: lot.id });
    const picked = pickActiveLease(all, today);
    assert(picked?.id === active.id, 'pickActiveLease renvoie le bail actif (succession)', errs);
    made.activeId = active.id;

    // 4. Colocation: bail actif avec plusieurs locataires sur le même bail.
    const colocation = await make({
      lease_type: 'Vide-Nu', date_start: '2025-01-01',
      tenants: [
        { name: 'Coloc 1', entry_date: '2025-01-01', email: 'c1@test.com' },
        { name: 'Coloc 2', entry_date: '2025-01-01', email: 'c2@test.com' },
      ],
      rent_excluding_charges: 800, charges: 80, deposit: 1600, status: 'actif',
    });
    assert((colocation.tenants || []).length === 2, 'colocation: 2 locataires sur le même bail', errs);

    // Sur ce lot, plusieurs baux actifs: pickActiveLease prend le plus récent (colocation).
    const all2 = await svc.entities.Lease.filter({ lot_id: lot.id });
    const picked2 = pickActiveLease(all2, today);
    assert(picked2?.id === colocation.id, 'pickActiveLease = bail actif le plus récent', errs);

    // activeLeaseInfo: la colocation est prioritaire sur la legacy lot.
    const info = activeLeaseInfo(all2, lot, prop, today);
    assert(info?.id === colocation.id && !info._legacy, 'activeLeaseInfo = bail actif (non legacy)', errs);
    assert((info?.tenants || []).length === 2, 'activeLeaseInfo expose les 2 colocataires', errs);

    // 5. Fin de bail: clôturer le bail actif via date_end passée.
    await svc.entities.Lease.update(colocation.id, { date_end: '2025-06-30' });
    const all3 = await svc.entities.Lease.filter({ lot_id: lot.id });
    const postEnd = all3.find((l: any) => l.id === colocation.id);
    assert(computeLeaseStatus(postEnd, today) === 'termine', 'fin de bail → status termine après date_end', errs);
    const picked3 = pickActiveLease(all3, today);
    assert(picked3?.id === active.id, 'après fin de bail, le bail actif retombe sur le précédent', errs);

    // 6. pickLeaseForPeriod: quittance d'un mois couvert par le bail passé.
    const lease2023 = pickLeaseForPeriod(all3, 2023, 6);
    assert(lease2023?.id === past.id, 'pickLeaseForPeriod 2023-06 = bail passé', errs);
    const leaseNowMonth = pickLeaseForPeriod(all3, today.slice(0, 4) as any, Number(today.slice(5, 7)));
    assert(!!leaseNowMonth && leaseNowMonth.id === active.id, 'pickLeaseForPeriod mois courant = bail actif', errs);
    // Période antérieure à tout bail (le bail actif open-ended démarre en 2024-03,
    // le bail passé en 2023-01) : 2022-01 n'est couvert par aucun bail.
    const none = pickLeaseForPeriod(all3, 2022, 1);
    assert(none === null, 'pickLeaseForPeriod 2022-01 = aucun bail', errs);

    // Nettoyage des données de test.
    for (const id of ids) { try { await svc.entities.Lease.delete(id); } catch (e) { /* ignore */ } }
    try { await svc.entities.Lot.delete(lot.id); } catch (e) { /* ignore */ }
    try { await svc.entities.Property.delete(prop.id); } catch (e) { /* ignore */ }

    return Response.json({
      ok: errs.length === 0,
      passed: 6 - errs.length,
      total: 6,
      errors: errs,
      tested: ['bail passé', 'bail futur', 'bail actif + succession', 'colocation', 'fin de bail', 'période quittance'],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}