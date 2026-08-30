import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import computeOwnership from '../../../base44/functions/computeOwnership/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const OWNER_B = 'b.bailleur@example.fr';

function clientFor(owner, seed = {}, role = 'admin') {
  return makeClient({ seed, user: { id: 'u-' + owner, email: owner, full_name: owner, role } });
}

function seedDirect() {
  const propA = { id: 'prop-a', owner_id: OWNER_A, name: 'Immeuble A' };
  const personP = { id: 'h-p', owner_id: OWNER_A, name: 'M. X', type: 'Personne physique' };
  const linkP = { id: 'ph-1', owner_id: OWNER_A, property_id: 'prop-a', holder_id: 'h-p', share_percent: 100 };
  return clientFor(OWNER_A, { Property: [propA], Holder: [personP], PropertyHolder: [linkP] });
}

function seedNested() {
  const propA = { id: 'prop-a', owner_id: OWNER_A, name: 'Immeuble A' };
  const sci = { id: 'h-sci', owner_id: OWNER_A, name: 'SCI Beta', type: 'SCI' };
  const personP = { id: 'h-p', owner_id: OWNER_A, name: 'M. X', type: 'Personne physique' };
  const member = { id: 'hm-1', owner_id: OWNER_A, parent_holder_id: 'h-sci', member_holder_id: 'h-p', share_percent: 100 };
  const link = { id: 'ph-1', owner_id: OWNER_A, property_id: 'prop-a', holder_id: 'h-sci', share_percent: 100 };
  return clientFor(OWNER_A, { Property: [propA], Holder: [sci, personP], HolderMember: [member], PropertyHolder: [link] });
}

describe('PRIORITÉ 3 — computeOwnership (détention économique)', () => {
  beforeEach(() => { active.current = seedDirect(); });

  it('happy path — répartition directe 100% → 1 personne à 100%', async () => {
    const { status, data } = await run(computeOwnership, { property_id: 'prop-a' });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.economic_breakdown).toHaveLength(1);
    expect(data.economic_breakdown[0].economic_percent).toBeCloseTo(100, 0);
  });

  it('happy path — holder_id renvoie la part économique d\'un déteneur précis', async () => {
    const { status, data } = await run(computeOwnership, { property_id: 'prop-a', holder_id: 'h-p' });
    expect(status).toBe(200);
    expect(data.economic_percent).toBeCloseTo(100, 0);
  });

  it('happy path — chaîne imbriquée Personne → SCI → Bien (100%)', async () => {
    active.current = seedNested();
    const { status, data } = await run(computeOwnership, { property_id: 'prop-a' });
    expect(status).toBe(200);
    expect(data.economic_breakdown).toHaveLength(1);
    expect(data.economic_breakdown[0].economic_percent).toBeCloseTo(100, 0);
  });

  it('validation — sans property_id → 400', async () => {
    const { status } = await run(computeOwnership, {});
    expect(status).toBe(400);
  });

  it('auth — sans user → 401', async () => {
    active.current = makeClient({ user: null });
    const { status } = await run(computeOwnership, { property_id: 'prop-a' });
    expect(status).toBe(401);
  });

  it('isolation — bien d\'un autre propriétaire → 404', async () => {
    active.current = clientFor(OWNER_B, { Property: [{ id: 'prop-a', owner_id: OWNER_A, name: 'A' }] });
    const { status } = await run(computeOwnership, { property_id: 'prop-a' });
    expect(status).toBe(404);
  });

  it('isolation — holder_id d\'un autre patrimoine → 404', async () => {
    active.current = clientFor(OWNER_A, { Property: [{ id: 'prop-a', owner_id: OWNER_A, name: 'A' }], Holder: [{ id: 'h-x', owner_id: OWNER_B, name: 'Y', type: 'Personne physique' }] });
    const { status } = await run(computeOwnership, { property_id: 'prop-a', holder_id: 'h-x' });
    expect(status).toBe(404);
  });
});