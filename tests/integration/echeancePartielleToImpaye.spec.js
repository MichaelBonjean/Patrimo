import { describe, it, expect, beforeEach } from 'vitest';
import { syncImpayesForLease } from '../../base44/shared/impayeEngine.ts';
import { makeMockService } from '../helpers/mockService.js';

const OWNER = 'bailleur@x.com';
const LEASE_ID = 'lease-1';

async function seed(svc, { dueTotal, paid, dueDate, asOf }) {
  await svc.entities.Lease.create({
    id: LEASE_ID, owner_id: OWNER, property_id: 'p1', lot_id: 'l1',
    tenants: [{ name: 'Jean Dupont', email: 'jean@x.com' }],
  });
  await svc.entities.Property.create({ id: 'p1', name: 'Immeuble', owner_id: OWNER });
  await svc.entities.Lot.create({ id: 'l1', property_id: 'p1', designation: 'T2', owner_id: OWNER });
  await svc.entities.RentDue.create({
    id: 'due-1', lease_id: LEASE_ID, lot_id: 'l1', property_id: 'p1',
    year: 2024, month: 1, period: '2024-01', due_date: dueDate,
    rent_excluding_charges: dueTotal, total_due: dueTotal,
    paid_amount: paid, balance: Math.max(0, dueTotal - paid),
    status: 'unpaid', owner_id: OWNER, is_demo: true,
  });
  if (paid > 0) {
    await svc.entities.Payment.create({
      lease_id: LEASE_ID, date: '2024-01-06', amount: paid, payer_type: 'tenant', owner_id: OWNER,
      allocations: [{ rent_due_id: 'due-1', amount: paid }],
    });
  }
  return asOf;
}

describe('INTÉGRATION — échéance partielle → impayé', () => {
  let svc;
  beforeEach(() => { svc = makeMockService(); });

  it('échéance échue partiellement payée → impayé créé avec missing_amount > 0', async () => {
    const asOf = await seed(svc, { dueTotal: 900, paid: 400, dueDate: '2024-01-05', asOf: '2024-01-15' });
    const r = await syncImpayesForLease({ entities: svc.entities }, LEASE_ID, asOf);
    expect(r.created).toBe(1);
    const imp = await svc.entities.Impaye.list();
    expect(imp.length).toBe(1);
    expect(imp[0].missing_amount).toBe(500);
    expect(imp[0].outstanding_amount).toBe(500);
    expect(imp[0].status).toBe('echeance_impayee');
    expect(imp[0].late_days).toBe(10);
  });

  it('échéance intégralement payée → aucun impayé créé (soldée)', async () => {
    const asOf = await seed(svc, { dueTotal: 900, paid: 900, dueDate: '2024-01-05', asOf: '2024-01-15' });
    const r = await syncImpayesForLease({ entities: svc.entities }, LEASE_ID, asOf);
    expect(r.created).toBe(0);
    expect((await svc.entities.Impaye.list()).length).toBe(0);
  });

  it("échéance non échue → aucun impayé (ne pas marquer d'avance)", async () => {
    const asOf = await seed(svc, { dueTotal: 900, paid: 0, dueDate: '2024-02-05', asOf: '2024-01-15' });
    const r = await syncImpayesForLease({ entities: svc.entities }, LEASE_ID, asOf);
    expect(r.created).toBe(0);
    expect((await svc.entities.Impaye.list()).length).toBe(0);
  });

  it("régularisation : un impayé existant est soldé si la balance passe à 0", async () => {
    const asOf = '2024-01-15';
    // 1) impayé créé (paiement partiel 400/900)
    await seed(svc, { dueTotal: 900, paid: 400, dueDate: '2024-01-05', asOf });
    await syncImpayesForLease({ entities: svc.entities }, LEASE_ID, asOf);
    let imp = await svc.entities.Impaye.list();
    expect(imp[0].status).toBe('echeance_impayee');

    // 2) on ajoute le solde (500) et on resynchronise
    await svc.entities.Payment.create({
      lease_id: LEASE_ID, date: '2024-01-20', amount: 500, payer_type: 'tenant', owner_id: OWNER,
      allocations: [{ rent_due_id: 'due-1', amount: 500 }],
    });
    const due = (await svc.entities.RentDue.list())[0];
    await svc.entities.RentDue.update(due.id, { paid_amount: 900, balance: 0, status: 'paid' });
    const r = await syncImpayesForLease({ entities: svc.entities }, LEASE_ID, '2024-01-21');
    expect(r.regularized).toBe(1);
    imp = await svc.entities.Impaye.list();
    expect(imp[0].status).toBe('régularisé');
    expect(imp[0].missing_amount).toBe(0);
  });

  it('paiement CAF seul (partiel) → impayé avec missing_amount = reste', async () => {
    const asOf = await seed(svc, { dueTotal: 700, paid: 300, dueDate: '2024-01-05', asOf: '2024-01-15' });
    await syncImpayesForLease({ entities: svc.entities }, LEASE_ID, asOf);
    const imp = await svc.entities.Impaye.list();
    expect(imp[0].missing_amount).toBe(400);
  });
});