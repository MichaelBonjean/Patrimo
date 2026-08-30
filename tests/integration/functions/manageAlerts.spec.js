import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import alertsHandler from '../../../base44/functions/manageAlerts/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const OWNER_B = 'b.bailleur@example.fr';

function clientFor(owner, seed = {}) {
  return makeClient({
    seed,
    user: { id: 'u-' + owner, email: owner, full_name: owner, patrimony_id: owner, patrimony_role: 'OWNER' },
  });
}

function seedAlerts() {
  const a1 = { id: 'al-a1', owner_id: OWNER_A, fingerprint: 'fp-a1', source: 'loyer_impaye', priority: 'urgent', status: 'active', title: 'A1', message: 'm', date: '2026-08-01' };
  const b1 = { id: 'al-b1', owner_id: OWNER_B, fingerprint: 'fp-b1', source: 'loyer_impaye', priority: 'urgent', status: 'active', title: 'B1', message: 'm', date: '2026-08-01' };
  return clientFor(OWNER_A, { Alert: [a1, b1] });
}

describe('PRIORITÉ 2 — manageAlerts', () => {
  beforeEach(() => { active.current = seedAlerts(); });

  it('happy path — op=list rafraîchit et renvoie alertes + compteurs cohérents', async () => {
    active.current = clientFor(OWNER_A, {}); // patrimoine vide (le moteur émet des alertes calendaires)
    const { status, data } = await run(alertsHandler, { op: 'list' });
    expect(status).toBe(200);
    expect(Array.isArray(data.alerts)).toBe(true);
    // totalVisible = nombre d'alertes actives ou reportées (cohérence du compteur)
    const visible = data.alerts.filter((a) => a.status === 'active' || a.status === 'snoozed').length;
    expect(data.counts.totalVisible).toBe(visible);
  });

  it('happy path — resolve marque l\'alerte traitée', async () => {
    const { status, data } = await run(alertsHandler, { op: 'resolve', id: 'al-a1' });
    expect(status).toBe(200);
    expect(data.record.status).toBe('resolved');
    expect(data.record.resolved_date).toBeTruthy();
  });

  it('happy path — snooze reporte (snoozed + snooze_until)', async () => {
    const { status, data } = await run(alertsHandler, { op: 'snooze', id: 'al-a1', days: 14 });
    expect(status).toBe(200);
    expect(data.record.status).toBe('snoozed');
    expect(data.record.snooze_until).toBeTruthy();
  });

  it('happy path — ignore + reactivate', async () => {
    const ig = await run(alertsHandler, { op: 'ignore', id: 'al-a1' });
    expect(ig.data.record.status).toBe('ignored');
    const re = await run(alertsHandler, { op: 'reactivate', id: 'al-a1' });
    expect(re.data.record.status).toBe('active');
    expect(re.data.record.snooze_until).toBeNull();
  });

  it('happy path — bulkResolve traite plusieurs alertes', async () => {
    active.current = clientFor(OWNER_A, { Alert: [
      { id: 'a1', owner_id: OWNER_A, fingerprint: 'f1', source: 'dpe', priority: 'important', status: 'active', title: 't', message: 'm', date: '2026-08-01' },
      { id: 'a2', owner_id: OWNER_A, fingerprint: 'f2', source: 'dpe', priority: 'important', status: 'active', title: 't', message: 'm', date: '2026-08-01' },
    ] });
    const { status, data } = await run(alertsHandler, { op: 'bulkResolve', ids: ['a1', 'a2'] });
    expect(status).toBe(200);
    expect(data.n).toBe(2);
  });

  it('auth — sans user → 401', async () => {
    active.current = makeClient({ user: null });
    const { status } = await run(alertsHandler, { op: 'list' });
    expect(status).toBe(401);
  });

  it('isolation — A ne peut pas toucher l\'alerte de B (404, jamais de mutation)', async () => {
    const before = active.current.asServiceRole.entities.Alert.update.mock.calls.length;
    const { status, data } = await run(alertsHandler, { op: 'resolve', id: 'al-b1' });
    expect(status).toBe(404);
    expect(data.error).toMatch(/introuvable/i);
    expect(active.current.asServiceRole.entities.Alert.update.mock.calls.length).toBe(before);
  });

  it('validation — resolve sans id → 400', async () => {
    const { status, data } = await run(alertsHandler, { op: 'resolve' });
    expect(status).toBe(400);
    expect(data.error).toMatch(/id/i);
  });

  it('validation — op inconnu → 400', async () => {
    const { status } = await run(alertsHandler, { op: 'nopenope' });
    expect(status).toBe(400);
  });

  it('idempotence — resolve 2x la même alerte ne crée qu\'un seul update de statut', async () => {
    await run(alertsHandler, { op: 'resolve', id: 'al-a1' });
    await run(alertsHandler, { op: 'resolve', id: 'al-a1' });
    const updates = active.current.find('Alert', { id: 'al-a1' })[0];
    expect(updates.status).toBe('resolved');
    // un seul alerte A persistante, pas de doublon
    expect(active.current.find('Alert', { owner_id: OWNER_A })).toHaveLength(1);
  });
});