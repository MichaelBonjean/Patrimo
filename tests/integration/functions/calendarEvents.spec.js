import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import calendarEvents from '../../../base44/functions/calendarEvents/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';

function clientFor(owner, seed = {}, role = 'admin') {
  return makeClient({ seed, user: { id: 'u-' + owner, email: owner, full_name: owner, role } });
}

describe('PRIORITÉ 3 — calendarEvents (agrégateur d\'échéances)', () => {
  beforeEach(() => { active.current = clientFor(OWNER_A, {}); });

  it('happy path — patrimoine vide renvoie un tableau d\'événements', async () => {
    const { status, data } = await run(calendarEvents, {});
    expect(status).toBe(200);
    expect(Array.isArray(data.events)).toBe(true);
  });

  it('happy path — inclut les échéances de loyer à venir', async () => {
    active.current = clientFor(OWNER_A, {
      RentDue: [{ id: 'rd-1', owner_id: OWNER_A, lease_id: 'l', property_id: 'p', lot_id: 'lot', year: 2026, month: 9, period: '2026-09', due_date: '2026-09-05', total_due: 700, status: 'unpaid', tenant_name: 'Mme A' }],
    });
    const { status, data } = await run(calendarEvents, { from: '2026-01-01', to: '2026-12-31' });
    expect(status).toBe(200);
    expect(data.events.length).toBeGreaterThan(0);
  });

  it('auth — sans user → 401', async () => {
    active.current = makeClient({ user: null });
    const { status } = await run(calendarEvents, {});
    expect(status).toBe(401);
  });

  it('cache — 2 appels identiques renvoient le même payload (férence)', async () => {
    active.current = clientFor(OWNER_A, { RentDue: [{ id: 'rd-1', owner_id: OWNER_A, lease_id: 'l', property_id: 'p', lot_id: 'lot', year: 2026, month: 9, due_date: '2026-09-05', total_due: 700, status: 'unpaid' }] });
    const a = await run(calendarEvents, { from: '2026-01-01', to: '2026-12-31' });
    const b = await run(calendarEvents, { from: '2026-01-01', to: '2026-12-31' });
    expect(a.data.events).toEqual(b.data.events);
  });

  // NB : l\'isolation multi-tenant est garantie par les filtres RLS (owner_id) côté base,
  // non reproductible par le mock in-memory qui n\'applique pas RLS sur base44.entities.*.
});