import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import monthCloseHandler from '../../../base44/functions/manageMonthClose/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const OWNER_B = 'b.bailleur@example.fr';

function clientFor(owner, seed = {}) {
  return makeClient({
    seed,
    user: { id: 'u-' + owner, email: owner, full_name: owner, patrimony_id: owner, patrimony_role: 'OWNER' },
  });
}

describe('PRIORITÉ 2 — manageMonthClose', () => {
  beforeEach(() => { active.current = clientFor(OWNER_A); });

  it('happy path — analyze renvoie un résumé + statut open', async () => {
    const { status, data } = await run(monthCloseHandler, { op: 'analyze', year: 2026, month: 7 });
    expect(status).toBe(200);
    expect(data.status).toBe('open');
    expect(typeof data.summary).toBe('object');
  });

  it('happy path — close crée le marqueur closed + historise', async () => {
    const { status, data } = await run(monthCloseHandler, { op: 'close', year: 2026, month: 7 });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.record.status).toBe('closed');
    expect(data.record.history).toHaveLength(1);
    expect(data.record.history[0].action).toBe('close');
  });

  it('happy path — reopen repasse open et historise (2 entrées)', async () => {
    await run(monthCloseHandler, { op: 'close', year: 2026, month: 7 });
    const { status, data } = await run(monthCloseHandler, { op: 'reopen', year: 2026, month: 7 });
    expect(status).toBe(200);
    expect(data.record.status).toBe('open');
    expect(data.record.history).toHaveLength(2);
    expect(data.record.history[1].action).toBe('reopen');
  });

  it('auth — sans user → 401', async () => {
    active.current = makeClient({ user: null });
    const { status } = await run(monthCloseHandler, { op: 'analyze', year: 2026, month: 7 });
    expect(status).toBe(401);
  });

  it('isolation — close de A ne crée pas de clôture pour B', async () => {
    active.current = clientFor(OWNER_A, { MonthClose: [{ id: 'mc-b', owner_id: OWNER_B, period: '2026-07', year: 2026, month: 7, status: 'open', history: [] }] });
    await run(monthCloseHandler, { op: 'close', year: 2026, month: 7 });
    const a = active.current.find('MonthClose', { owner_id: OWNER_A });
    const b = active.current.find('MonthClose', { owner_id: OWNER_B });
    expect(a).toHaveLength(1);
    expect(b[0].status).toBe('open'); // inchangé
  });

  it('validation — sans year/month → 400 ; op inconnu → 400', async () => {
    expect((await run(monthCloseHandler, { op: 'analyze', month: 7 })).status).toBe(400);
    expect((await run(monthCloseHandler, { op: 'analyze', year: 2026 })).status).toBe(400);
    expect((await run(monthCloseHandler, { op: 'nopenope', year: 2026, month: 7 })).status).toBe(400);
  });

  it('idempotence — close 2x = 1 seul enregistrement (history grossit, pas de doublon)', async () => {
    await run(monthCloseHandler, { op: 'close', year: 2026, month: 7 });
    await run(monthCloseHandler, { op: 'close', year: 2026, month: 7 });
    expect(active.current.find('MonthClose', { owner_id: OWNER_A, period: '2026-07' })).toHaveLength(1);
  });
});