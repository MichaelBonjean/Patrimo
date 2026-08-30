import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import revisionHandler from '../../../base44/functions/manageRentRevision/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const OWNER_B = 'b.bailleur@example.fr';

function clientFor(owner, seed = {}) {
  return makeClient({
    seed,
    user: { id: 'u-' + owner, email: owner, full_name: owner, patrimony_id: owner, patrimony_role: 'OWNER' },
  });
}

const leaseA = { id: 'lease-a', owner_id: OWNER_A, lot_id: 'lot-a', property_id: 'prop-a', rent_excluding_charges: 700, indexation_type: 'IRL', index_reference: 'T1 2024', index_value_initial: 140, index_value_current: 145, last_revision_date: '2025-01-01', date_start: '2024-01-01' };
const lotA = { id: 'lot-a', owner_id: OWNER_A, property_id: 'prop-a', designation: 'App. A', dpe_class: 'C' };
const propA = { id: 'prop-a', owner_id: OWNER_A, name: 'Immeuble A' };

function seedBase() { return clientFor(OWNER_A, { Lease: [leaseA], Lot: [lotA], Property: [propA] }); }

describe('PRIORITÉ 2 — manageRentRevision', () => {
  beforeEach(() => { active.current = seedBase(); });

  it('happy path — analyze calcule + persiste une proposition par bail', async () => {
    const { status, data } = await run(revisionHandler, { op: 'analyze' });
    expect(status).toBe(200);
    expect(data.proposals).toHaveLength(1);
    expect('newRent' in data.proposals[0]).toBe(true);
    expect(active.current.find('RentRevision', { lease_id: 'lease-a' })).toHaveLength(1);
  });

  it('happy path — compute (re)calcule pour un bail et persiste l\'indice éditable', async () => {
    const { status, data } = await run(revisionHandler, { op: 'compute', lease_id: 'lease-a', new_index_value: 150 });
    expect(status).toBe(200);
    expect(data.proposal.lease.id).toBe('lease-a');
    expect(active.current.find('Lease', { id: 'lease-a' })[0].index_value_current).toBe(150);
  });

  it('happy path — validate → validee ; apply → appliquee + bail mis à jour', async () => {
    active.current = clientFor(OWNER_A, {
      Lease: [leaseA], Lot: [lotA], Property: [propA],
      RentRevision: [{ id: 'rev1', owner_id: OWNER_A, lease_id: 'lease-a', lot_id: 'lot-a', property_id: 'prop-a', status: 'proposition', new_rent: 725, new_index_value: 150, indexation_type: 'IRL', old_rent: 700, old_index_value: 140, variation_amount: 25, variation_percent: 3.57, formula: 'f', new_revision_date: '2027-01-01', blocked_reason: '', can_apply: true }],
    });
    const v = await run(revisionHandler, { op: 'validate', rent_revision_id: 'rev1' });
    expect(v.status).toBe(200);
    expect(v.data.record.status).toBe('validee');
    const ap = await run(revisionHandler, { op: 'apply', rent_revision_id: 'rev1' });
    expect(ap.status).toBe(200);
    expect(ap.data.record.status).toBe('appliquee');
    expect(active.current.find('Lease', { id: 'lease-a' })[0].rent_excluding_charges).toBe(725);
  });

  it('happy path — reject → refusee', async () => {
    active.current = clientFor(OWNER_A, { RentRevision: [{ id: 'rev1', owner_id: OWNER_A, lease_id: 'lease-a', status: 'proposition', new_rent: 725 }] });
    const { status, data } = await run(revisionHandler, { op: 'reject', rent_revision_id: 'rev1' });
    expect(status).toBe(200);
    expect(data.record.status).toBe('refusee');
  });

  it('auth — sans user → 401', async () => {
    active.current = makeClient({ user: null });
    const { status } = await run(revisionHandler, { op: 'analyze' });
    expect(status).toBe(401);
  });

  it('isolation — A ne peut pas valider la proposition de B (404)', async () => {
    active.current = clientFor(OWNER_A, { RentRevision: [{ id: 'rev-b', owner_id: OWNER_B, lease_id: 'lb', status: 'proposition', new_rent: 900 }] });
    const { status } = await run(revisionHandler, { op: 'validate', rent_revision_id: 'rev-b' });
    expect(status).toBe(404);
  });

  it('validation — compute sans lease_id → 400', async () => {
    expect((await run(revisionHandler, { op: 'compute' })).status).toBe(400);
  });

  it('idempotence — validate 2x → 2e = 400 « déjà traitée » (pas de double mutation)', async () => {
    active.current = clientFor(OWNER_A, { RentRevision: [{ id: 'rev1', owner_id: OWNER_A, lease_id: 'lease-a', status: 'proposition', new_rent: 725 }] });
    await run(revisionHandler, { op: 'validate', rent_revision_id: 'rev1' });
    const second = await run(revisionHandler, { op: 'validate', rent_revision_id: 'rev1' });
    expect(second.status).toBe(400);
    expect(second.data.error.toLowerCase()).toContain('déjà');
  });
});