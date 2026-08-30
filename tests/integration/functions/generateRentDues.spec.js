import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import generateRentDues from '../../../base44/functions/generateRentDues/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';

function clientFor(owner, seed = {}, role = 'admin') {
  return makeClient({ seed, user: { id: 'u-' + owner, email: owner, full_name: owner, role } });
}

function seedBase() {
  const leaseA = { id: 'lease-a', owner_id: OWNER_A, lot_id: 'lot-a', property_id: 'prop-a', rent_excluding_charges: 700, charges: 0, due_day: 5, status: 'actif', date_start: '2024-01-01', tenants: [{ name: 'Mme A' }] };
  return clientFor(OWNER_A, { Lease: [leaseA] });
}

describe('PRIORITÉ 3 — generateRentDues (génération d\'échéances)', () => {
  beforeEach(() => { active.current = seedBase(); });

  it('happy path — crée au moins une échéance pour un bail actif (forward)', async () => {
    const { status, data } = await run(generateRentDues, { forward_months: 1 });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.active_leases).toBe(1);
    expect(data.created).toBeGreaterThan(0);
    expect(active.current.find('RentDue', { lease_id: 'lease-a' }).length).toBeGreaterThan(0);
  });

  it('happy path — lease_id limite au bail demandé', async () => {
    active.current = clientFor(OWNER_A, { Lease: [
      { id: 'lease-a', owner_id: OWNER_A, lot_id: 'lot-a', property_id: 'pa', rent_excluding_charges: 700, due_day: 5, status: 'actif', date_start: '2024-01-01', tenants: [{ name: 'A' }] },
      { id: 'lease-b', owner_id: OWNER_A, lot_id: 'lot-b', property_id: 'pb', rent_excluding_charges: 900, due_day: 5, status: 'actif', date_start: '2024-01-01', tenants: [{ name: 'B' }] },
    ] });
    const { status, data } = await run(generateRentDues, { lease_id: 'lease-b', forward_months: 1 });
    expect(status).toBe(200);
    expect(data.active_leases).toBe(1);
    expect(active.current.find('RentDue', { lease_id: 'lease-a' })).toHaveLength(0);
    expect(active.current.find('RentDue', { lease_id: 'lease-b' }).length).toBeGreaterThan(0);
  });

  it('idempotence — 2e exécution ne recrée rien (created 0)', async () => {
    await run(generateRentDues, { forward_months: 1 });
    const second = await run(generateRentDues, { forward_months: 1 });
    expect(second.status).toBe(200);
    expect(second.data.created).toBe(0);
    // pas de doublon sur la même période
    const periods = active.current.find('RentDue', { lease_id: 'lease-a' }).map((d) => d.period);
    expect(new Set(periods).size).toBe(periods.length);
  });

  it('RBAC — rôle user (non admin) → 403', async () => {
    active.current = clientFor(OWNER_A, { Lease: [] }, 'user');
    expect((await run(generateRentDues, { forward_months: 1 })).status).toBe(403);
  });

  it('système — sans user (cron) → 200', async () => {
    active.current = makeClient({ user: null, seed: { Lease: [{ id: 'lease-a', owner_id: OWNER_A, rent_excluding_charges: 700, due_day: 5, status: 'actif', date_start: '2024-01-01', tenants: [{ name: 'A' }] }] } });
    const { status, data } = await run(generateRentDues, { forward_months: 1 });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('bail inactif (date_start futur) → aucune échéance', async () => {
    active.current = clientFor(OWNER_A, { Lease: [{ id: 'lease-futur', owner_id: OWNER_A, rent_excluding_charges: 700, due_day: 5, status: 'futur', date_start: '2099-01-01', tenants: [{ name: 'F' }] }] });
    const { status, data } = await run(generateRentDues, { forward_months: 1 });
    expect(status).toBe(200);
    expect(data.active_leases).toBe(0);
    expect(data.created).toBe(0);
  });
});