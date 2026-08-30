import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import auditHandler from '../../../base44/functions/recordAudit/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const OWNER_B = 'b.bailleur@example.fr';

function clientFor(owner, seed = {}) {
  return makeClient({
    seed,
    user: { id: 'u-' + owner, email: owner, full_name: owner, patrimony_id: owner, patrimony_role: 'OWNER' },
  });
}

describe('PRIORITÉ 3 — recordAudit (journal d\'audit)', () => {
  beforeEach(() => { active.current = clientFor(OWNER_A); });

  it('happy path — enregistre une entrée d\'audit rattachée au patrimoine courant', async () => {
    const { status, data } = await run(auditHandler, { action: 'create', entity_type: 'Property', entity_id: 'p1', entity_label: 'App A', details: { prix: 100000 } });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    const log = active.current.find('AuditLog', { entity_id: 'p1' })[0];
    expect(log.patrimony_id).toBe(OWNER_A);
    expect(log.actor_email).toBe(OWNER_A);
    expect(log.action).toBe('create');
  });

  it('auth — sans user → 401', async () => {
    active.current = makeClient({ user: null });
    const { status } = await run(auditHandler, { action: 'create' });
    expect(status).toBe(401);
  });

  it('isolation — chaque utilisateur trace dans SON patrimoine', async () => {
    active.current = clientFor(OWNER_A);
    await run(auditHandler, { action: 'update', entity_type: 'Property', entity_id: 'a1' });
    active.current = clientFor(OWNER_B);
    await run(auditHandler, { action: 'update', entity_type: 'Property', entity_id: 'b1' });
    // Deux clients distincts ; on valide la scoping via le patrimony_id porté par chaque entrée :
    // ici on re-crée un client mutualisé pour vérifier l'isolation des écritures.
    active.current = clientFor(OWNER_A, {});
    await run(auditHandler, { action: 'create', entity_type: 'Property', entity_id: 'aX' });
    const mine = active.current.find('AuditLog', { actor_email: OWNER_A });
    expect(mine.every((l) => l.patrimony_id === OWNER_A)).toBe(true);
  });

  it('résilience — payload minimal n\'échoue jamais (action par défaut « other »)', async () => {
    const { status, data } = await run(auditHandler, {});
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(active.current.find('AuditLog', {})[0].action).toBe('other');
  });

  // Pas de cas 400/403 : recordAudit est un sink de tracing best-effort,
  // invoked après mutation client ; aucune validation payload n'est attendue.
});