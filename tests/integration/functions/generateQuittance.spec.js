import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import generateQuittance from '../../../base44/functions/generateQuittance/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const OWNER_B = 'b.bailleur@example.fr';

function clientFor(owner, seed = {}, role = 'admin') {
  return makeClient({ seed, user: { id: 'u-' + owner, email: owner, full_name: owner, role } });
}

function seedFullPaid() {
  const leaseA = { id: 'lease-a', owner_id: OWNER_A, lot_id: 'lot-a', property_id: 'prop-a', status: 'actif', date_start: '2024-01-01', tenants: [{ name: 'Mme A' }] };
  const lotA = { id: 'lot-a', owner_id: OWNER_A, property_id: 'prop-a', designation: 'App. A' };
  const propA = { id: 'prop-a', owner_id: OWNER_A, name: 'Immeuble A', address: '1 rue A', postal_code: '69001', city: 'Lyon' };
  const dueA = { id: 'rd-a1', owner_id: OWNER_A, lease_id: 'lease-a', year: 2026, month: 7, period: '2026-07', rent_excluding_charges: 700, charges: 0, total_due: 700, paid_amount: 0, balance: 700, status: 'unpaid' };
  const payA = { id: 'p-a1', owner_id: OWNER_A, lease_id: 'lease-a', date: '2026-07-03', amount: 700, payer_type: 'tenant', method: 'virement', allocations: [{ rent_due_id: 'rd-a1', amount: 700 }] };
  return clientFor(OWNER_A, { Lease: [leaseA], Lot: [lotA], Property: [propA], RentDue: [dueA], Payment: [payA] });
}

describe('PRIORITÉ 3 — generateQuittance (quittance immuable)', () => {
  beforeEach(() => { active.current = seedFullPaid(); });

  it('happy path — échéance soldée → quittance full', async () => {
    const { status, data } = await run(generateQuittance, { lease_id: 'lease-a', year: 2026, month: 7 });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.kind).toBe('full');
    expect(data.quittance).toBeTruthy();
    expect(data.quittance.total_due).toBe(700);
    expect(data.quittance.paid_amount).toBe(700);
  });

  it('happy path — paiement partiel → kind partial', async () => {
    // Réduit le paiement à 200
    active.current._records('Payment')[0].amount = 200;
    active.current._records('Payment')[0].allocations[0].amount = 200;
    const { status, data } = await run(generateQuittance, { lease_id: 'lease-a', year: 2026, month: 7 });
    expect(status).toBe(200);
    expect(data.kind).toBe('partial');
  });

  it('non éligible — aucun paiement → 409 reason unpaid', async () => {
    active.current = clientFor(OWNER_A, {
      Lease: [{ id: 'lease-a', owner_id: OWNER_A, lot_id: 'lot-a', property_id: 'prop-a', status: 'actif', date_start: '2024-01-01', tenants: [{ name: 'Mme A' }] }],
      RentDue: [{ id: 'rd-a1', owner_id: OWNER_A, lease_id: 'lease-a', year: 2026, month: 7, total_due: 700, paid_amount: 0, balance: 700, status: 'unpaid' }],
    });
    const { status, data } = await run(generateQuittance, { lease_id: 'lease-a', year: 2026, month: 7 });
    expect(status).toBe(409);
    expect(data.reason).toBe('unpaid');
  });

  it('non éligible — aucune échéance pour la période → 404 reason no_due', async () => {
    const { status, data } = await run(generateQuittance, { lease_id: 'lease-a', year: 2026, month: 12 });
    expect(status).toBe(404);
    expect(data.reason).toBe('no_due');
  });

  it('idempotence — 2 générations = 1 seule quittance (reason exists)', async () => {
    await run(generateQuittance, { lease_id: 'lease-a', year: 2026, month: 7 });
    const second = await run(generateQuittance, { lease_id: 'lease-a', year: 2026, month: 7 });
    expect(second.status).toBe(200);
    expect(second.data.reason).toBe('exists');
    expect(active.current.all('Quittance')).toHaveLength(1);
  });

  it('validation — lease_id manquant → 400 ; year/month invalides → 400', async () => {
    expect((await run(generateQuittance, { year: 2026, month: 7 })).status).toBe(400);
    expect((await run(generateQuittance, { lease_id: 'lease-a', year: 2026, month: 13 })).status).toBe(400);
  });

  it('auth — sans user → 401 ; rôle non admin/user → 403', async () => {
    active.current = makeClient({ user: null });
    expect((await run(generateQuittance, { lease_id: 'lease-a', year: 2026, month: 7 })).status).toBe(401);
    active.current = clientFor(OWNER_A, {
      Lease: [{ id: 'lease-a', owner_id: OWNER_A, status: 'actif', date_start: '2024-01-01', tenants: [{ name: 'Mme A' }] }],
      RentDue: [{ id: 'rd-a1', lease_id: 'lease-a', year: 2026, month: 7, total_due: 700, paid_amount: 0, status: 'unpaid' }],
      Payment: [{ id: 'p1', lease_id: 'lease-a', date: '2026-07-03', amount: 700, allocations: [{ rent_due_id: 'rd-a1', amount: 700 }] }],
    }, 'guest');
    expect((await run(generateQuittance, { lease_id: 'lease-a', year: 2026, month: 7 })).status).toBe(403);
  });

  it('isolation — B ne peut pas générer la quittance du bail de A (404)', async () => {
    active.current = clientFor(OWNER_B, {
      Lease: [{ id: 'lease-a', owner_id: OWNER_A, status: 'actif', date_start: '2024-01-01', tenants: [{ name: 'Mme A' }] }],
      RentDue: [{ id: 'rd-a1', owner_id: OWNER_A, lease_id: 'lease-a', year: 2026, month: 7, total_due: 700, paid_amount: 700, status: 'paid' }],
      Payment: [{ id: 'p1', owner_id: OWNER_A, lease_id: 'lease-a', date: '2026-07-03', amount: 700, allocations: [{ rent_due_id: 'rd-a1', amount: 700 }] }],
    });
    const { status } = await run(generateQuittance, { lease_id: 'lease-a', year: 2026, month: 7 });
    expect(status).toBe(404);
  });
});