import { describe, it, expect, beforeEach } from 'vitest';
import { generateQuittanceFor } from '../../base44/shared/quittanceEngine.ts';
import { makeMockService } from '../helpers/mockService.js';

const OWNER = 'bailleur@x.com';
const LEASE_ID = 'lease-1';
const LOT_ID = 'lot-1';
const PROP_ID = 'prop-1';

function seedBase(svc, dueTotal, payments) {
  // Revenue: un bail + une échéance + des paiements alloués
  return svc.entities.Lease.create({
    id: LEASE_ID, owner_id: OWNER, property_id: PROP_ID, lot_id: LOT_ID,
    tenants: [{ name: 'Jean Dupont' }],
  }).then(() =>
    svc.entities.RentDue.create({
      id: 'due-1', lease_id: LEASE_ID, lot_id: LOT_ID, property_id: PROP_ID,
      year: 2024, month: 1, period: '2024-01', due_date: '2024-01-05',
      rent_excluding_charges: 800, charges: 50, additional_amount: 50, total_due: dueTotal,
      paid_amount: 0, balance: dueTotal, status: 'unpaid', owner_id: OWNER,
    }),
  ).then(() =>
    Promise.all(payments.map((p) => svc.entities.Payment.create({
      lease_id: LEASE_ID, date: p.date, amount: p.amount, payer_type: p.payer_type,
      method: p.method || 'virement', allocations: p.allocations, owner_id: OWNER,
    }))),
  );
}

describe('INTÉGRATION — échéance payée → quittance', () => {
  let svc;
  beforeEach(() => { svc = makeMockService(); });

  it('échéance intégralement payée → quittance « full » créée', async () => {
    await seedBase(svc, 900, [
      { date: '2024-01-05', amount: 900, payer_type: 'tenant',
        allocations: [{ rent_due_id: 'due-1', amount: 900 }] },
    ]);
    const r = await generateQuittanceFor({ entities: svc.entities }, { email: OWNER, full_name: 'Bailleur' }, { lease_id: LEASE_ID, year: 2024, month: 1 });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('full');
    expect(r.reason).toBe('created');
    expect(r.quittance.total_due).toBe(900);
    expect(r.quittance.paid_amount).toBe(900);
    expect(r.quittance.balance).toBe(0);
    expect(r.quittance.status).toBe('generated');
  });

  it('échéance partiellement payée → reçu « partial »', async () => {
    await seedBase(svc, 900, [
      { date: '2024-01-05', amount: 500, payer_type: 'tenant',
        allocations: [{ rent_due_id: 'due-1', amount: 500 }] },
    ]);
    const r = await generateQuittanceFor({ entities: svc.entities }, { email: OWNER }, { lease_id: LEASE_ID, year: 2024, month: 1 });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('partial');
    expect(r.quittance.paid_amount).toBe(500);
    expect(r.quittance.balance).toBe(400);
  });

  it("aucun paiement → refus (raison 'unpaid', aucune quittance créée)", async () => {
    await seedBase(svc, 900, []);
    const r = await generateQuittanceFor({ entities: svc.entities }, { email: OWNER }, { lease_id: LEASE_ID, year: 2024, month: 1 });
    expect(r.ok).toBe(false);
    expect(r.body?.reason).toBe('unpaid');
    expect((await svc.entities.Quittance.list()).length).toBe(0);
  });

  it('idempotence : une seconde génération retourne la même quittance (reason "exists")', async () => {
    await seedBase(svc, 900, [
      { date: '2024-01-05', amount: 900, payer_type: 'tenant',
        allocations: [{ rent_due_id: 'due-1', amount: 900 }] },
    ]);
    const args = { lease_id: LEASE_ID, year: 2024, month: 1 };
    const r1 = await generateQuittanceFor({ entities: svc.entities }, { email: OWNER }, args);
    const r2 = await generateQuittanceFor({ entities: svc.entities }, { email: OWNER }, args);
    expect(r1.ok && r2.ok).toBe(true);
    expect(r2.reason).toBe('exists');
    expect(r2.quittance.id).toBe(r1.quittance.id);
    expect((await svc.entities.Quittance.list()).length).toBe(1);
  });

  it("bail d’un autre propriétaire → introuvable (isolation)", async () => {
    await seedBase(svc, 900, [
      { date: '2024-01-05', amount: 900, payer_type: 'tenant',
        allocations: [{ rent_due_id: 'due-1', amount: 900 }] },
    ]);
    const r = await generateQuittanceFor({ entities: svc.entities }, { email: 'autrebailleur@x.com' }, { lease_id: LEASE_ID, year: 2024, month: 1 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
  });
});