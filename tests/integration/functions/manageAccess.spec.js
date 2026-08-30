import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import accessHandler from '../../../base44/functions/manageAccess/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const PATRIMONY_A = OWNER_A;

function ownerClient(seed = {}) {
  return makeClient({
    seed,
    user: { id: 'u-a', email: OWNER_A, full_name: 'David A', patrimony_id: PATRIMONY_A, patrimony_role: 'OWNER' },
  });
}

describe('PRIORITÉ 2 — manageAccess (RBAC multi-utilisateurs)', () => {
  beforeEach(() => { active.current = ownerClient(); });

  it('resolveMe — bootstrap : premier user devient OWNER', async () => {
    const { status, data } = await run(accessHandler, { op: 'resolveMe' });
    expect(status).toBe(200);
    expect(data.patrimony_id).toBe(OWNER_A);
    expect(data.patrimony_role).toBe('OWNER');
    expect(active.current.find('PatrimonyMember', { user_email: OWNER_A })[0].status).toBe('active');
  });

  it('resolveMe — membre invité → activé', async () => {
    active.current = ownerClient({ PatrimonyMember: [
      { id: 'm1', patrimony_id: PATRIMONY_A, user_email: OWNER_A, patrimony_role: 'MANAGER', status: 'invited', invited_date: '2026-08-01' },
    ] });
    const { status, data } = await run(accessHandler, { op: 'resolveMe' });
    expect(status).toBe(200);
    expect(data.member.status).toBe('active');
  });

  it('resolveMe — membre révoqué → 403 access_revoked', async () => {
    active.current = ownerClient({ PatrimonyMember: [
      { id: 'm1', patrimony_id: PATRIMONY_A, user_email: OWNER_A, patrimony_role: 'MANAGER', status: 'revoked' },
    ] });
    const { status, data } = await run(accessHandler, { op: 'resolveMe' });
    expect(status).toBe(403);
    expect(data.error).toBe('access_revoked');
  });

  it('invite — crée un membre invité + journalise l\'audit', async () => {
    const { status, data } = await run(accessHandler, { op: 'invite', email: 'marie@example.fr', role: 'MANAGER', full_name: 'Marie' });
    expect(status).toBe(200);
    expect(data.member.patrimony_role).toBe('MANAGER');
    expect(data.member.status).toBe('invited');
    expect(active.current.find('AuditLog', { action: 'admin_access' })[0]).toBeTruthy();
  });

  it('updateRole / revoke / reactivate', async () => {
    active.current = ownerClient({ PatrimonyMember: [
      { id: 'm1', patrimony_id: PATRIMONY_A, user_email: 'x@example.fr', patrimony_role: 'MANAGER', status: 'active' },
    ] });
    const up = await run(accessHandler, { op: 'updateRole', email: 'x@example.fr', role: 'ACCOUNTANT' });
    expect(up.status).toBe(200);
    expect(up.data.member.patrimony_role).toBe('ACCOUNTANT');
    const rv = await run(accessHandler, { op: 'revoke', email: 'x@example.fr' });
    expect(rv.data.member.status).toBe('revoked');
    const re = await run(accessHandler, { op: 'reactivate', email: 'x@example.fr' });
    expect(re.data.member.status).toBe('active');
  });

  it('auth — sans user → 401', async () => {
    active.current = makeClient({ user: null });
    const { status } = await run(accessHandler, { op: 'list' });
    expect(status).toBe(401);
  });

  it('RBAC — rôle READ_ONLY (sans manage_team) → invite interdit 403', async () => {
    active.current = makeClient({ user: { id: 'ro', email: 'ro@example.fr', patrimony_id: 'ro@example.fr', patrimony_role: 'READ_ONLY' } });
    const { status, data } = await run(accessHandler, { op: 'invite', email: 'z@example.fr', role: 'MANAGER' });
    expect(status).toBe(403);
    expect(data.error).toMatch(/insuffisant/i);
  });

  it('RBAC — auditLog : READ_ONLY → 403 ; ACCOUNTANT → 200', async () => {
    active.current = makeClient({ user: { id: 'ro', email: 'ro@example.fr', patrimony_id: 'ro@example.fr', patrimony_role: 'READ_ONLY' }, seed: {} });
    expect((await run(accessHandler, { op: 'auditLog' })).status).toBe(403);
    active.current = makeClient({ user: { id: 'acc', email: 'acc@example.fr', patrimony_id: 'acc@example.fr', patrimony_role: 'ACCOUNTANT' }, seed: { AuditLog: [{ id: 'l1', patrimony_id: 'acc@example.fr', actor_email: 'acc@example.fr', action: 'create', date: '2026-08-01' }] } });
    const ok = await run(accessHandler, { op: 'auditLog' });
    expect(ok.status).toBe(200);
    expect(ok.data.entries).toHaveLength(1);
  });

  it('isolation — list ne renvoie que les membres du patrimoine courant', async () => {
    active.current = ownerClient({ PatrimonyMember: [
      { id: 'ma', patrimony_id: PATRIMONY_A, user_email: 'a@example.fr', patrimony_role: 'MANAGER', status: 'active' },
      { id: 'mb', patrimony_id: 'other@example.fr', user_email: 'b@example.fr', patrimony_role: 'MANAGER', status: 'active' },
    ] });
    const { status, data } = await run(accessHandler, { op: 'list' });
    expect(status).toBe(200);
    expect(data.members.every((m) => m.patrimony_id === PATRIMONY_A)).toBe(true);
    expect(data.members).toHaveLength(1);
  });

  it('validation — invite sans email → 400 ; rôle invalide → 400 ; rôle OWNER → 400', async () => {
    expect((await run(accessHandler, { op: 'invite', role: 'MANAGER' })).status).toBe(400);
    expect((await run(accessHandler, { op: 'invite', email: 'x@example.fr', role: 'INVENTÉ' })).status).toBe(400);
    expect((await run(accessHandler, { op: 'invite', email: 'x@example.fr', role: 'OWNER' })).status).toBe(400);
  });

  it('idempotence — inviter 2x le même email → 409 (pas de doublon)', async () => {
    await run(accessHandler, { op: 'invite', email: 'dup@example.fr', role: 'MANAGER' });
    const second = await run(accessHandler, { op: 'invite', email: 'dup@example.fr', role: 'MANAGER' });
    expect(second.status).toBe(409);
    expect(active.current.find('PatrimonyMember', { user_email: 'dup@example.fr' })).toHaveLength(1);
  });
});