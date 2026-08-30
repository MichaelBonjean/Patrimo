import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import recordRecouvrement from '../../../base44/functions/recordRecouvrement/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const OWNER_B = 'b.bailleur@example.fr';

function clientFor(owner, seed = {}, role = 'admin') {
  return makeClient({ seed, user: { id: 'u-' + owner, email: owner, full_name: owner, role } });
}

function seedBase() {
  const impA = { id: 'imp-a1', owner_id: OWNER_A, rent_due_id: 'rd-a1', lease_id: 'lease-a', lot_id: 'lot-a', property_id: 'prop-a', tenant_name: 'Mme A', expected_amount: 700, initial_amount: 700, missing_amount: 700, outstanding_amount: 700, year: 2026, month: 7, period: '2026-07', status: 'echeance_impayee', action_history: [] };
  return clientFor(OWNER_A, { Impaye: [impA] });
}

describe('PRIORITÉ 3 — recordRecouvrement (workflow de recouvrement)', () => {
  beforeEach(() => { active.current = seedBase(); });

  it('happy path — action pure (note) ajoute une entrée d\'historique sans changer le statut', async () => {
    const { status, data } = await run(recordRecouvrement, { impaye_id: 'imp-a1', action_type: 'note', method: 'email', note: 'appel téléphonique' });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.action).toBeTruthy();
    const imp = active.current.find('Impaye', { id: 'imp-a1' })[0];
    expect(imp.action_history).toHaveLength(1);
    expect(imp.status).toBe('echeance_impayee');
  });

  it('happy path — stage rappel_amiable fait progresser le workflow', async () => {
    const { status, data } = await run(recordRecouvrement, { impaye_id: 'imp-a1', stage: 'rappel_amiable', method: 'email' });
    expect(status).toBe(200);
    expect(data.status).toBe('rappel_amiable');
    expect(active.current.find('Impaye', { id: 'imp-a1' })[0].last_relance_date).toBeTruthy();
  });

  it('happy path — stage régularisé solde la dette (missing/outstanding = 0)', async () => {
    const { status, data } = await run(recordRecouvrement, { impaye_id: 'imp-a1', stage: 'régularisé', method: 'paiement', amount: 700 });
    expect(status).toBe(200);
    expect(data.status).toBe('régularisé');
    const imp = active.current.find('Impaye', { id: 'imp-a1' })[0];
    expect(imp.missing_amount).toBe(0);
    expect(imp.outstanding_amount).toBe(0);
    expect(imp.regularized_date).toBeTruthy();
  });

  it('happy path — stage abandonné', async () => {
    const { status, data } = await run(recordRecouvrement, { impaye_id: 'imp-a1', stage: 'abandonné' });
    expect(status).toBe(200);
    expect(data.status).toBe('abandonné');
  });

  it('validation — sans impaye_id → 400 ; stage inconnu → 400', async () => {
    expect((await run(recordRecouvrement, { stage: 'rappel_amiable' })).status).toBe(400);
    expect((await run(recordRecouvrement, { impaye_id: 'imp-a1', stage: 'INVENTÉ' })).status).toBe(400);
  });

  it('auth — sans user → 401 ; rôle non admin/user → 403', async () => {
    active.current = makeClient({ user: null });
    expect((await run(recordRecouvrement, { impaye_id: 'imp-a1' })).status).toBe(401);
    active.current = clientFor(OWNER_A, { Impaye: [{ id: 'imp-a1', owner_id: OWNER_A, status: 'echeance_impayee', action_history: [] }] }, 'guest');
    expect((await run(recordRecouvrement, { impaye_id: 'imp-a1' })).status).toBe(403);
  });

  it('isolation — B ne peut pas agir sur l\'impayé de A (404, pas de mutation)', async () => {
    active.current = clientFor(OWNER_B, { Impaye: [{ id: 'imp-a1', owner_id: OWNER_A, status: 'echeance_impayee', action_history: [] }] });
    const { status } = await run(recordRecouvrement, { impaye_id: 'imp-a1', stage: 'rappel_amiable' });
    expect(status).toBe(404);
    expect(active.current.find('Impaye', { id: 'imp-a1' })[0].status).toBe('echeance_impayee');
  });

  // Pas d\'idempotence : l\'historique est append-only (chaque action = 1 entrée horodatée).
  it('append-only — 2 actions → 2 entrées d\'historique distinctes', async () => {
    await run(recordRecouvrement, { impaye_id: 'imp-a1', action_type: 'note', note: '1' });
    await run(recordRecouvrement, { impaye_id: 'imp-a1', action_type: 'note', note: '2' });
    expect(active.current.find('Impaye', { id: 'imp-a1' })[0].action_history).toHaveLength(2);
  });
});