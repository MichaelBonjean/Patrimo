import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import chargeRegHandler from '../../../base44/functions/manageChargeRegularization/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const OWNER_B = 'b.bailleur@example.fr';

function clientFor(owner, seed = {}) {
  return makeClient({
    seed,
    user: { id: 'u-' + owner, email: owner, full_name: owner, patrimony_id: owner, patrimony_role: 'OWNER' },
  });
}

function seedBase() {
  const leaseA = { id: 'lease-a', owner_id: OWNER_A, lot_id: 'lot-a', property_id: 'prop-a', lease_type: 'Vide-Nu', status: 'actif', date_start: '2024-01-01', tenants: [{ name: 'Mme A' }] };
  const lotA = { id: 'lot-a', owner_id: OWNER_A, property_id: 'prop-a', designation: 'App. A' };
  const propA = { id: 'prop-a', owner_id: OWNER_A, name: 'Immeuble A', address: '1 rue A', postal_code: '69001', city: 'Lyon' };
  const dueA = { id: 'rd-a1', owner_id: OWNER_A, lease_id: 'lease-a', year: 2025, month: 1, charges: 100, notes: '' };
  return clientFor(OWNER_A, { Lease: [leaseA], Lot: [lotA], Property: [propA], RentDue: [dueA] });
}

describe('PRIORITÉ 2 — manageChargeRegularization', () => {
  beforeEach(() => { active.current = seedBase(); });

  it('happy path — analyze renvoie une ligne par bail avec provisions', async () => {
    const { status, data } = await run(chargeRegHandler, { op: 'analyze', year: 2025 });
    expect(status).toBe(200);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].provisions_collected).toBe(100);
  });

  it('happy path — save crée un brouillon avec solde calculé', async () => {
    const { status, data } = await run(chargeRegHandler, { op: 'save', lease_id: 'lease-a', year: 2025, ventilation: [{ category: 'teom', amount: 120 }] });
    expect(status).toBe(200);
    expect(data.record.status).toBe('draft');
    expect(typeof data.record.solde).toBe('number');
  });

  it('happy path — validate avec solde>0 crée une échéance + verrouille', async () => {
    // Pré-créer un brouillon avec solde débiteur (récupérable > provisions)
    active.current = clientFor(OWNER_A, {
      Lease: [{ id: 'lease-a', owner_id: OWNER_A, lot_id: 'lot-a', property_id: 'prop-a', status: 'actif', tenants: [{ name: 'Mme A' }] }],
      ChargeRegularization: [{ id: 'cr1', owner_id: OWNER_A, lease_id: 'lease-a', lot_id: 'lot-a', property_id: 'prop-a', year: 2025, period: '2025', status: 'draft', provisions_collected: 100, ventilation: [{ category: 'teom', category_label: 'TEOM', amount: 250 }], tenant_name: 'Mme A' }],
    });
    const { status, data } = await run(chargeRegHandler, { op: 'validate', id: 'cr1' });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.due_rentdue_id).toBeTruthy();
    expect(active.current.find('RentDue', { id: data.due_rentdue_id })[0]).toBeTruthy();
  });

  it('happy path — delete supprime la régularisation', async () => {
    active.current = clientFor(OWNER_A, { ChargeRegularization: [{ id: 'cr1', owner_id: OWNER_A, lease_id: 'l', year: 2025, status: 'draft' }] });
    const { status, data } = await run(chargeRegHandler, { op: 'delete', id: 'cr1' });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(active.current.find('ChargeRegularization', { id: 'cr1' })).toHaveLength(0);
  });

  it('auth — sans user → 401', async () => {
    active.current = makeClient({ user: null });
    const { status } = await run(chargeRegHandler, { op: 'analyze', year: 2025 });
    expect(status).toBe(401);
  });

  it('isolation — B ne peut pas sauver le bail de A (Bail introuvable 404)', async () => {
    active.current = makeClient({ seed: { Lease: [{ id: 'lease-a', owner_id: OWNER_A, lot_id: 'lot-a', property_id: 'prop-a', status: 'actif', tenants: [{ name: 'Mme A' }] }] }, user: { id: 'ub', email: OWNER_B, patrimony_id: OWNER_B, patrimony_role: 'OWNER' } });
    const { status, data } = await run(chargeRegHandler, { op: 'save', lease_id: 'lease-a', year: 2025, ventilation: [] });
    expect(status).toBe(404);
    expect(data.error).toMatch(/bail/i);
  });

  it('validation — analyze sans year → 400 ; save sans lease_id → 400 ; validate sans id → 400', async () => {
    expect((await run(chargeRegHandler, { op: 'analyze' })).status).toBe(400);
    expect((await run(chargeRegHandler, { op: 'save', year: 2025 })).status).toBe(400);
    expect((await run(chargeRegHandler, { op: 'validate' })).status).toBe(400);
  });

  it('idempotence — save 2x le même bail/an = 1 seul brouillon (update, pas doublon)', async () => {
    await run(chargeRegHandler, { op: 'save', lease_id: 'lease-a', year: 2025, ventilation: [{ category: 'teom', amount: 120 }] });
    await run(chargeRegHandler, { op: 'save', lease_id: 'lease-a', year: 2025, ventilation: [{ category: 'teom', amount: 130 }] });
    expect(active.current.find('ChargeRegularization', { lease_id: 'lease-a' })).toHaveLength(1);
  });
});