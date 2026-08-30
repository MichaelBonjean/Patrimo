import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import recordPayment from '../../../base44/functions/recordPayment/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const OWNER_B = 'b.bailleur@example.fr';

function clientFor(owner, seed = {}, role = 'admin') {
  return makeClient({
    seed,
    user: { id: 'u-' + owner, email: owner, full_name: owner, role },
  });
}

function seedBase() {
  const leaseA = { id: 'lease-a', owner_id: OWNER_A, lot_id: 'lot-a', property_id: 'prop-a', rent_excluding_charges: 700, charges: 0, due_day: 5, status: 'actif', date_start: '2024-01-01', tenants: [{ name: 'Mme A' }] };
  const dueA = { id: 'rd-a1', owner_id: OWNER_A, lease_id: 'lease-a', year: 2026, month: 7, period: '2026-07', due_date: '2026-07-05', rent_excluding_charges: 700, charges: 0, total_due: 700, paid_amount: 0, balance: 700, status: 'unpaid' };
  return clientFor(OWNER_A, { Lease: [leaseA], RentDue: [dueA] });
}

describe('PRIORITÉ 3 — recordPayment (compte locataire)', () => {
  beforeEach(() => { active.current = seedBase(); });

  it('happy path — paiement exact FIFO passe l\'échéance à paid', async () => {
    const { status, data } = await run(recordPayment, { lease_id: 'lease-a', date: '2026-07-03', amount: 700, payer_type: 'tenant', method: 'virement' });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.payment_id).toBeTruthy();
    expect(data.allocations.length).toBeGreaterThan(0);
    expect(data.updated).toContain('rd-a1');
    expect(active.current.find('RentDue', { id: 'rd-a1' })[0].status).toBe('paid');
  });

  it('happy path — paiement partiel → status partial', async () => {
    const { status, data } = await run(recordPayment, { lease_id: 'lease-a', date: '2026-07-03', amount: 300, payer_type: 'tenant' });
    expect(status).toBe(200);
    expect(active.current.find('RentDue', { id: 'rd-a1' })[0].status).toBe('partial');
  });

  it('happy path — allocation explicite en trop-perçu (overpaid)', async () => {
    const { status, data } = await run(recordPayment, { lease_id: 'lease-a', date: '2026-07-03', amount: 800, payer_type: 'tenant', allocations: [{ rent_due_id: 'rd-a1', amount: 800 }] });
    expect(status).toBe(200);
    expect(data.unallocated).toBe(0);
    expect(active.current.find('RentDue', { id: 'rd-a1' })[0].status).toBe('overpaid');
  });

  it('validation — somme des allocations > montant → 400', async () => {
    const { status } = await run(recordPayment, { lease_id: 'lease-a', date: '2026-07-03', amount: 500, payer_type: 'tenant', allocations: [{ rent_due_id: 'rd-a1', amount: 600 }] });
    expect(status).toBe(400);
  });

  it('validation — champs requis (lease_id, date, amount>0, payer_type, method)', async () => {
    expect((await run(recordPayment, { date: '2026-07-03', amount: 700, payer_type: 'tenant' })).status).toBe(400);
    expect((await run(recordPayment, { lease_id: 'lease-a', amount: 700, payer_type: 'tenant' })).status).toBe(400);
    expect((await run(recordPayment, { lease_id: 'lease-a', date: '2026-07-03', amount: 0, payer_type: 'tenant' })).status).toBe(400);
    expect((await run(recordPayment, { lease_id: 'lease-a', date: '2026-07-03', amount: 700, payer_type: 'INVENTÉ' })).status).toBe(400);
    expect((await run(recordPayment, { lease_id: 'lease-a', date: '2026-07-03', amount: 700, payer_type: 'tenant', method: 'INVENTÉ' })).status).toBe(400);
  });

  it('auth — sans user → 401 ; rôle non admin/user → 403', async () => {
    active.current = makeClient({ user: null });
    expect((await run(recordPayment, { lease_id: 'lease-a', date: '2026-07-03', amount: 700, payer_type: 'tenant' })).status).toBe(401);
    active.current = clientFor(OWNER_A, { Lease: [{ id: 'lease-a', owner_id: OWNER_A, status: 'actif', date_start: '2024-01-01' }] }, 'guest');
    expect((await run(recordPayment, { lease_id: 'lease-a', date: '2026-07-03', amount: 700, payer_type: 'tenant' })).status).toBe(403);
  });

  it('isolation — B ne peut pas payer le bail de A (404, pas de Payment créé)', async () => {
    active.current = clientFor(OWNER_B, { Lease: [{ id: 'lease-a', owner_id: OWNER_A, status: 'actif' }] });
    const before = active.current.all('Payment').length;
    const { status, data } = await run(recordPayment, { lease_id: 'lease-a', date: '2026-07-03', amount: 700, payer_type: 'tenant' });
    expect(status).toBe(404);
    expect(active.current.all('Payment').length).toBe(before);
  });

  it('isolation — échéance inconnue dans allocations → 400 (pas d\'effet de bord)', async () => {
    const { status } = await run(recordPayment, { lease_id: 'lease-a', date: '2026-07-03', amount: 700, payer_type: 'tenant', allocations: [{ rent_due_id: 'rd-fantome', amount: 700 }] });
    expect(status).toBe(400);
  });
});