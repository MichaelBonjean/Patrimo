import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';
import {
  hashToken, _resetRateLimiter, PORTAL_FAIL_MAX, generateSecureToken
} from '../../../base44/shared/tenantPortal.ts';

// Mock du SDK : le handler importe `npm:@base44/sdk@0.8.40` ; on renvoie le
// client actif positionné par chaque test via vi.hoisted.
const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({
  createClientFromRequest: () => active.current,
}));

import accessHandler from '../../../base44/functions/tenantPortalAccess/entry.ts';
import contactHandler from '../../../base44/functions/tenantPortalContact/entry.ts';
import incidentHandler from '../../../base44/functions/tenantPortalIncident/entry.ts';
import updateHandler from '../../../base44/functions/tenantPortalUpdate/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const OWNER_B = 'b.bailleur@example.fr';
const FUT = '2099-12-31T00:00:00.000Z';

async function seed() {
  const hashA = await hashToken('TOK_A');
  const hashB = await hashToken('TOK_B');
  const now = new Date().toISOString();
  return makeClient({
    seed: {
      Lot: [
        { id: 'lot-a', owner_id: OWNER_A, property_id: 'prop-a', designation: 'App. A',
          tenants: [{ id: 't1', name: 'Mme A', email: 'a.tenant@example.fr', phone: '' }] },
        { id: 'lot-b', owner_id: OWNER_B, property_id: 'prop-b', designation: 'App. B',
          tenants: [{ id: 't2', name: 'M. B', email: 'b.tenant@example.fr' }] },
      ],
      Property: [
        { id: 'prop-a', owner_id: OWNER_A, name: 'Immeuble A', address: '1 rue A', postal_code: '69001', city: 'Lyon', landlord_email: 'da@example.fr' },
        { id: 'prop-b', owner_id: OWNER_B, name: 'Immeuble B', address: '2 rue B', postal_code: '75001', city: 'Paris', landlord_email: 'db@example.fr' },
      ],
      Lease: [
        { id: 'lease-a', owner_id: OWNER_A, lot_id: 'lot-a', property_id: 'prop-a', date_start: '2020-01-01', status: 'actif', tenants: [{ id: 't1', name: 'Mme A' }] },
        { id: 'lease-b', owner_id: OWNER_B, lot_id: 'lot-b', property_id: 'prop-b', date_start: '2021-01-01', status: 'actif', tenants: [{ id: 't2', name: 'M. B' }] },
      ],
      TenantAccess: [
        { id: 'acc-a', owner_id: OWNER_A, lot_id: 'lot-a', property_id: 'prop-a', lease_id: 'lease-a',
          tenant_id: 't1', tenant_name: 'Mme A', email: 'a.tenant@example.fr',
          magic_token: 'TOK_A', token_hash: hashA, token_version: 1, created_at: now,
          expires_at: FUT, issued_date: '2026-01-01', last_used_at: null, last_accessed_date: null,
          revoked_at: null, failed_attempts: 0 },
        { id: 'acc-b', owner_id: OWNER_B, lot_id: 'lot-b', property_id: 'prop-b', lease_id: 'lease-b',
          tenant_id: 't2', tenant_name: 'M. B', email: 'b.tenant@example.fr',
          magic_token: 'TOK_B', token_hash: hashB, token_version: 1, created_at: now,
          expires_at: FUT, issued_date: '2026-01-01', last_used_at: null, last_accessed_date: null,
          revoked_at: null, failed_attempts: 0 },
      ],
      Quittance: [
        { id: 'q-a1', owner_id: OWNER_A, lease_id: 'lease-a', lot_id: 'lot-a', period: '2026-07', receipt_number: 'Q-A1', total: 700, total_due: 700, paid_amount: 700, status: 'sent' },
        { id: 'q-b1', owner_id: OWNER_B, lease_id: 'lease-b', lot_id: 'lot-b', period: '2026-07', receipt_number: 'Q-B1', total: 1200, total_due: 1200, paid_amount: 1200, status: 'sent' },
      ],
      Payment: [
        { id: 'pay-a1', owner_id: OWNER_A, lease_id: 'lease-a', date: '2026-07-05', amount: 700, payer_type: 'tenant', method: 'virement', reference: 'VIR-1' },
        { id: 'pay-b1', owner_id: OWNER_B, lease_id: 'lease-b', date: '2026-07-05', amount: 1200, payer_type: 'tenant', method: 'cb' },
      ],
      User: [
        { id: 'u-a', email: OWNER_A, full_name: 'David A' },
        { id: 'u-b', email: OWNER_B, full_name: 'Eva B' },
      ],
    },
    user: null,
  });
}

function accessA() { return active.current._records('TenantAccess').find((r) => r.magic_token === 'TOK_A'); }
function accessB() { return active.current._records('TenantAccess').find((r) => r.magic_token === 'TOK_B'); }

describe('Portail locataire — sécurité renforcée', () => {
  beforeEach(async () => {
    _resetRateLimiter();
    active.current = await seed();
  });

  // --- TOKEN ----------------------------------------------------------------

  describe('token', () => {
    it('valide — renvoie locataire, lot, quittances et paiements du bail', async () => {
      const { status, data } = await run(accessHandler, { token: 'TOK_A' });
      expect(status).toBe(200);
      expect(data.valid).toBe(true);
      expect(data.tenant.name).toBe('Mme A');
      expect(data.lot.designation).toBe('App. A');
      expect(data.property.landlord_name).toBe('David A');
      expect(data.quittances).toHaveLength(1);
      expect(data.quittances[0].id).toBe('q-a1');
      expect(data.payments).toHaveLength(1);
      expect(data.payments[0].id).toBe('pay-a1');
      expect(data.payments[0].method).toBe('virement');
    });

    it('inexistant → 403 not_found', async () => {
      const { status, data } = await run(accessHandler, { token: 'CA_N_EXISTE_PAS' });
      expect(status).toBe(403);
      expect(data.valid).toBe(false);
      expect(data.code).toBe('not_found');
    });

    it('expiré → 403 expired (et NON prolongé)', async () => {
      accessA().expires_at = '2020-01-01T00:00:00.000Z';
      const { status, data } = await run(accessHandler, { token: 'TOK_A' });
      expect(status).toBe(403);
      expect(data.code).toBe('expired');
      // L'expiration n'est jamais renouvelée automatiquement.
      expect(accessA().expires_at).toBe('2020-01-01T00:00:00.000Z');
    });

    it('révoqué → 403 revoked', async () => {
      accessA().revoked_at = '2026-01-01T00:00:00.000Z';
      const { status, data } = await run(accessHandler, { token: 'TOK_A' });
      expect(status).toBe(403);
      expect(data.code).toBe('revoked');
    });

    it("un accès valide n'est PAS prolongé (last_used_at mis à jour, expires_at inchangé)", async () => {
      const before = accessA().expires_at;
      await run(accessHandler, { token: 'TOK_A' });
      const after = accessA();
      expect(after.expires_at).toBe(before);
      expect(after.last_used_at).toBeTruthy();
      expect(after.failed_attempts).toBe(0);
    });
  });

  // --- CHAÎNE D'AUTORISATION -------------------------------------------------

  describe('chaîne TenantAccess → Lease → Lot → Property → Owner', () => {
    it('isolation multi-tenant — le token de A ne renvoie jamais les données de B', async () => {
      const a = await run(accessHandler, { token: 'TOK_A' });
      const b = await run(accessHandler, { token: 'TOK_B' });
      expect(a.data.quittances.every((q) => q.id.startsWith('q-a'))).toBe(true);
      expect(b.data.quittances.every((q) => q.id.startsWith('q-b'))).toBe(true);
      expect(a.data.payments.every((p) => p.id.startsWith('pay-a'))).toBe(true);
      expect(b.data.payments.every((p) => p.id.startsWith('pay-b'))).toBe(true);
      expect(a.data.tenant.name).not.toBe(b.data.tenant.name);
    });

    it('modification manuelle lot_id (Access A → lot B) → chain_broken', async () => {
      accessA().lot_id = 'lot-b';
      const { status, data } = await run(accessHandler, { token: 'TOK_A' });
      expect(status).toBe(403);
      expect(data.code).toBe('chain_broken');
    });

    it('modification manuelle lease_id (Access A → lease B) → chain_broken', async () => {
      accessA().lease_id = 'lease-b';
      const { status, data } = await run(accessHandler, { token: 'TOK_A' });
      expect(status).toBe(403);
      expect(data.code).toBe('chain_broken');
    });

    it('modification manuelle property_id (Access A → prop B) → chain_broken', async () => {
      accessA().property_id = 'prop-b';
      const { status, data } = await run(accessHandler, { token: 'TOK_A' });
      expect(status).toBe(403);
      expect(data.code).toBe('chain_broken');
    });

    it("quittance d'un autre bail (owner B sur lease_id A) — non renvoyée à A", async () => {
      active.current._records('Quittance').push({
        id: 'q-forge', owner_id: OWNER_B, lease_id: 'lease-a', lot_id: 'lot-a',
        period: '2026-08', receipt_number: 'Q-X', total: 999, status: 'sent',
      });
      const { data } = await run(accessHandler, { token: 'TOK_A' });
      expect(data.quittances.map((q) => q.id)).not.toContain('q-forge');
      expect(data.quittances).toHaveLength(1);
    });

    it('paiements proviennent de Payment (jamais des Transaction income du lot)', async () => {
      active.current._records('Transaction').push({
        id: 'tx-fake', owner_id: OWNER_A, lot_id: 'lot-a', lease_id: 'lease-a',
        type: 'income', year: 2026, month: 7, amount: 999, category: 'loyer',
      });
      const { data } = await run(accessHandler, { token: 'TOK_A' });
      expect(data.payments).toHaveLength(1); // seul pay-a1, pas tx-fake
      expect(data.payments.find((p) => p.id === 'tx-fake')).toBeUndefined();
    });
  });

  // --- RATE LIMITING / BRUTE-FORCE ------------------------------------------

  describe('rate limiting & brute-force', () => {
    it('brute-force de tokens aléatoires → 429 rate_limited au-delà du seuil', async () => {
      const results = [];
      for (let i = 0; i < 15; i++) {
        const r = await run(accessHandler, { token: 'GUESS-' + i }, { 'x-forwarded-for': '9.9.9.9' });
        results.push(r);
      }
      expect(results.some((r) => r.status === 429 && r.data && r.data.code === 'rate_limited')).toBe(true);
    });

    it('auto-révocation après N échecs de chaîne (tampering répété) → revoked', async () => {
      accessA().lot_id = 'lot-b'; // tampering → chain_broken à chaque appel
      for (let i = 0; i < PORTAL_FAIL_MAX; i++) {
        await run(accessHandler, { token: 'TOK_A' });
      }
      const { status, data } = await run(accessHandler, { token: 'TOK_A' });
      expect(status).toBe(403);
      expect(data.code).toBe('revoked');
    });
  });

  // --- INCIDENT / UPDATE / CONTACT (rattachement sécurisé) ------------------

  describe('tenantPortalIncident', () => {
    it('happy path — crée un incident rattaché au bon bailleur', async () => {
      const { status, data } = await run(incidentHandler, { token: 'TOK_A', subject: 'Fuite', description: 'Sous évier.' });
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.id).toBeTruthy();
      const inc = active.current.find('Incident', { lot_id: 'lot-a' })[0];
      expect(inc.owner_id).toBe(OWNER_A);
      expect(inc.property_id).toBe('prop-a');
      expect(inc.channel).toBe('portail');
      expect(inc.status).toBe('ouvert');
    });

    it('objet vide → 400 Objet requis', async () => {
      const { status, data } = await run(incidentHandler, { token: 'TOK_A', subject: '', description: 'x' });
      expect(status).toBe(400);
      expect(typeof data.error).toBe('string');
      expect(data.error.toLowerCase()).toContain('objet');
    });

    it("XSS — payload script stocké tel quel (jamais exécuté)", async () => {
      const payload = '<script>alert(1)</script>';
      const { status } = await run(incidentHandler, { token: 'TOK_A', subject: payload, description: payload });
      expect(status).toBe(200);
      const inc = active.current.find('Incident', { lot_id: 'lot-a' })[0];
      expect(inc.subject).toBe(payload);
      expect(inc.description).toBe(payload);
    });

    it("isolation — un incident via token A reste rattaché à OWNER_A", async () => {
      await run(incidentHandler, { token: 'TOK_A', subject: 'A', description: 'd_A' });
      await run(incidentHandler, { token: 'TOK_B', subject: 'B', description: 'd_B' });
      const incs = active.current.all('Incident');
      expect(incs).toHaveLength(2);
      expect(incs.filter((i) => i.owner_id === OWNER_A).every((i) => i.subject === 'A')).toBe(true);
      expect(incs.filter((i) => i.owner_id === OWNER_B).every((i) => i.subject === 'B')).toBe(true);
    });

    it('token révoqué → 403 revoked, aucun incident créé', async () => {
      accessA().revoked_at = '2026-01-01T00:00:00.000Z';
      const { status, data } = await run(incidentHandler, { token: 'TOK_A', subject: 'x' });
      expect(status).toBe(403);
      expect(data.code).toBe('revoked');
      expect(active.current.all('Incident')).toHaveLength(0);
    });
  });

  describe('tenantPortalUpdate', () => {
    it('happy path — met à jour téléphone + email (tenants[])', async () => {
      const { status, data } = await run(updateHandler, { token: 'TOK_A', phone: '0601020304', email: 'new.a@example.fr' });
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      const lot = active.current.find('Lot', { id: 'lot-a' })[0];
      expect(lot.tenants[0].phone).toBe('0601020304');
      expect(lot.tenants[0].email).toBe('new.a@example.fr');
      const acc = active.current.find('TenantAccess', { magic_token: 'TOK_A' })[0];
      expect(acc.email).toBe('new.a@example.fr');
    });

    it('token invalide → 403, jamais de mutation du lot', async () => {
      const lotUpdate = active.current.asServiceRole.entities.Lot.update;
      const before = lotUpdate.mock.calls.length;
      const { status } = await run(updateHandler, { token: 'NOPE', phone: '06' });
      expect(status).toBe(403);
      expect(lotUpdate.mock.calls.length).toBe(before);
    });
  });

  describe('tenantPortalContact', () => {
    it('happy path — envoie un email au bailleur', async () => {
      const { status, data } = await run(contactHandler, { token: 'TOK_A', message: 'Bonjour, fuite eau.' });
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
      const sent = active.current.asServiceRole.integrations.Core.SendEmail.mock.calls;
      expect(sent).toHaveLength(1);
      expect(sent[0][0].to).toBe('da@example.fr');
    });

    it('message vide → 400', async () => {
      const { status, data } = await run(contactHandler, { token: 'TOK_A', message: '   ' });
      expect(status).toBe(400);
      expect(data.ok).toBe(false);
    });

    it('bailleur sans email de contact → 400 propre', async () => {
      active.current._records('Property').find((p) => p.id === 'prop-a').landlord_email = '';
      const { status, data } = await run(contactHandler, { token: 'TOK_A', message: 'x' });
      expect(status).toBe(400);
      expect(data.ok).toBe(false);
    });
  });

  // --- PROPRIÉTÉS DU TOKEN ---------------------------------------------------

  describe('propriétés cryptographiques', () => {
    it('hashToken est déterministe et préfixé (différent du SHA-256 nu)', async () => {
      const a = await hashToken('TOK_A');
      const b = await hashToken('TOK_A');
      const naked = await hashToken(''); // ne doit pas collisionner
      expect(a).toBe(b);
      expect(a).not.toBe(naked);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generateSecureToken produit 64 hex aléatoires et uniques', () => {
      const t1 = generateSecureToken();
      const t2 = generateSecureToken();
      expect(t1).toMatch(/^[0-9a-f]{64}$/);
      expect(t1).not.toBe(t2);
    });
  });
});