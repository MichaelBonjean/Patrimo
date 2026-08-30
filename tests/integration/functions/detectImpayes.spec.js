import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import detectImpayes from '../../../base44/functions/detectImpayes/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';

describe('PRIORITÉ 3 — detectImpayes (cron + admin)', () => {
  beforeEach(() => {
    active.current = makeClient({ seed: {}, user: { id: 'ua', email: OWNER_A, full_name: 'A', role: 'admin' } });
  });

  it('happy path — admin authentifié renvoie ok + as_of (patrimoine vide)', async () => {
    const { status, data } = await run(detectImpayes, {});
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.as_of).toBeTruthy();
  });

  it('happy path — sans user (cron système) → ok, scan global', async () => {
    active.current = makeClient({ user: null });
    const { status, data } = await run(detectImpayes, {});
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('RBAC — rôle user (non admin) → 403', async () => {
    active.current = makeClient({ user: { id: 'uu', email: 'u@example.fr', role: 'user' } });
    const { status, data } = await run(detectImpayes, {});
    expect(status).toBe(403);
    expect(data.error).toMatch(/admin|forbidden/i);
  });

  it('isolation — admin A ne crée pas d\'impayé pour les échéances d\'un autre bailleur', async () => {
    // Due de B mûre et impayée ; B est absent du patrimoine de A.
    active.current = makeClient({
      seed: {
        RentDue: [{ id: 'rd-b1', owner_id: 'b@example.fr', lease_id: 'lb', property_id: 'pb', lot_id: 'lotb', year: 2026, month: 6, period: '2026-06', due_date: '2026-06-05', total_due: 700, paid_amount: 0, balance: 700, status: 'unpaid' }],
        Lease: [{ id: 'lb', owner_id: 'b@example.fr', property_id: 'pb', lot_id: 'lotb', status: 'actif', date_start: '2024-01-01', rent_excluding_charges: 700, tenants: [{ name: 'M. B' }] }],
      },
      user: { id: 'ua', email: OWNER_A, full_name: 'A', role: 'admin' },
    });
    const { status, data } = await run(detectImpayes, {});
    expect(status).toBe(200);
    // Aucun impayé rattaché à b@example.fr ne doit être créé pour le patrimoine de A.
    const mineByOwner = active.current.all('Impaye').filter((i) => i.owner_id === OWNER_A);
    const othersByOwner = active.current.all('Impaye').filter((i) => i.owner_id === 'b@example.fr');
    expect(othersByOwner).toHaveLength(0);
    expect(mineByOwner).toHaveLength(0);
    void data;
  });
});