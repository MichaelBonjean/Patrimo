import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import transfersHandler from '../../../base44/functions/manageInternalTransfers/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const OWNER_B = 'b.bailleur@example.fr';

function clientFor(owner, seed = {}, role = 'admin') {
  return makeClient({ seed, user: { id: 'u-' + owner, email: owner, full_name: owner, role } });
}

// Une paire candidats : sortie sur prop-a, entrée sur prop-b, même montant, dates proches.
function seedPair() {
  const txOut = { id: 'tx-out', owner_id: OWNER_A, property_id: 'prop-a', year: 2026, month: 7, category: 'other_expense', amount: -500, type: 'expense', note: 'vir' };
  const txIn = { id: 'tx-in', owner_id: OWNER_A, property_id: 'prop-b', year: 2026, month: 7, category: 'rent', amount: 500, type: 'income', note: 'vir' };
  return clientFor(OWNER_A, { Transaction: [txOut, txIn] });
}

describe('PRIORITÉ 3 — manageInternalTransfers (virements inter-comptes)', () => {
  beforeEach(() => { active.current = seedPair(); });

  it('happy path — detect renvoie les paires candidates sans écrire', async () => {
    const { status, data } = await run(transfersHandler, { action: 'detect' });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.count).toBeGreaterThanOrEqual(1);
    // rien écrit
    expect(active.current.find('Transaction', { id: 'tx-out' })[0].transfer_pair_id).toBeFalsy();
  });

  it('happy path — apply tagge les paires en internal_transfer + liage', async () => {
    const { status, data } = await run(transfersHandler, { action: 'apply' });
    expect(status).toBe(200);
    expect(data.applied_pairs).toBeGreaterThanOrEqual(1);
    expect(active.current.find('Transaction', { id: 'tx-out' })[0].category).toBe('internal_transfer');
    expect(active.current.find('Transaction', { id: 'tx-out' })[0].transfer_pair_id).toBe('tx-in');
    expect(active.current.find('Transaction', { id: 'tx-in' })[0].transfer_pair_id).toBe('tx-out');
  });

  it('idempotence — apply 2x ne duplique pas le liage', async () => {
    await run(transfersHandler, { action: 'apply' });
    const second = await run(transfersHandler, { action: 'apply' });
    expect(second.status).toBe(200);
    expect(active.current.find('Transaction', { id: 'tx-out' }).length).toBe(1);
    expect(active.current.find('Transaction', { id: 'tx-in' }).length).toBe(1);
  });

  it('happy path — link manuel lie deux transactions opposées', async () => {
    const { status, data } = await run(transfersHandler, { action: 'link', out_tx_id: 'tx-out', in_tx_id: 'tx-in' });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(active.current.find('Transaction', { id: 'tx-out' })[0].transfer_pair_id).toBe('tx-in');
  });

  it('validation — link sans ids → 400 ; même sens → 400 ; même bien → 400', async () => {
    expect((await run(transfersHandler, { action: 'link', out_tx_id: 'tx-out' })).status).toBe(400);
    expect((await run(transfersHandler, { action: 'link', out_tx_id: 'tx-out', in_tx_id: 'tx-out' })).status).toBe(400);
    active.current = clientFor(OWNER_A, { Transaction: [
      { id: 'a', owner_id: OWNER_A, property_id: 'prop-a', amount: -500, type: 'expense' },
      { id: 'b', owner_id: OWNER_A, property_id: 'prop-a', amount: 500, type: 'income' },
    ] });
    expect((await run(transfersHandler, { action: 'link', out_tx_id: 'a', in_tx_id: 'b' })).status).toBe(400);
  });

  it('validation — link introuvable → 404 ; action inconnue → 400', async () => {
    expect((await run(transfersHandler, { action: 'link', out_tx_id: 'zzz', in_tx_id: 'tx-in' })).status).toBe(404);
    expect((await run(transfersHandler, { action: 'nopenope' })).status).toBe(400);
  });

  it('happy path — unlink rompt le liage (les deux côtés)', async () => {
    await run(transfersHandler, { action: 'link', out_tx_id: 'tx-out', in_tx_id: 'tx-in' });
    const { status, data } = await run(transfersHandler, { action: 'unlink', transaction_id: 'tx-out' });
    expect(status).toBe(200);
    expect(data.unlinked).toBe(2);
    expect(active.current.find('Transaction', { id: 'tx-out' })[0].transfer_pair_id).toBe('');
    expect(active.current.find('Transaction', { id: 'tx-in' })[0].transfer_pair_id).toBe('');
  });

  it('validation — unlink sans paire → 404 ; sans transaction_id → 400', async () => {
    expect((await run(transfersHandler, { action: 'unlink' })).status).toBe(400);
    expect((await run(transfersHandler, { action: 'unlink', transaction_id: 'tx-out' })).status).toBe(404);
  });

  it('auth — sans user → 403 ; rôle non admin → 403', async () => {
    active.current = makeClient({ user: null });
    expect((await run(transfersHandler, { action: 'detect' })).status).toBe(403);
    active.current = clientFor(OWNER_A, { Transaction: [] }, 'user');
    expect((await run(transfersHandler, { action: 'detect' })).status).toBe(403);
  });

  it('isolation — link B sur des transactions de A → 404 (filtre owner_id)', async () => {
    active.current = clientFor(OWNER_B, {});
    const { status } = await run(transfersHandler, { action: 'link', out_tx_id: 'tx-out', in_tx_id: 'tx-in' });
    expect(status).toBe(404);
  });
});