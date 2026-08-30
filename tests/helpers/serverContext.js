// Harness d'intégration pour les fonctions base44/functions/*/entry.ts.
//
// Principe : on appelle le VRAI handler (Request/Response Web) en mockant
// uniquement `@base44/sdk` via un client in-memory branché sur un store
// par entité. Aucun réseau. Les fonctions tenantPortal* utilisent
// `base44.asServiceRole` (bypass RLS) — l'isolation réelle est portée par le
// code métier (filtres owner_id / lot_id).
//
// Usage dans une spec :
//   const active = vi.hoisted(() => ({ current: null }));
//   vi.mock('npm:@base44/sdk@0.8.40', () => ({
//     createClientFromRequest: () => active.current,
//   }));
//   active.current = makeClient({ seed });
//   const { status, data } = await run(handler, { token: '...' });

import { vi } from 'vitest';

export function makeRequest(body, headers = {}) {
  return new Request('https://app.test/functions/handler', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });
}

export async function run(handler, body, headers = {}) {
  const res = await handler(makeRequest(body, headers));
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  return { status: res.status, data };
}

function matchPred(r, pred) {
  return Object.entries(pred || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.$in)) {
      return v.$in.includes(r[k]);
    }
    return r[k] === v;
  });
}

function makeEntity(records, name) {
  const nextId = () => `${name}-${records(name).length + 1}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    list: async () => [...records(name)],
    filter: async (pred = {}) => records(name).filter((r) => matchPred(r, pred)),
    get: async (id) => records(name).find((r) => r.id === id) || null,
    create: vi.fn(async (data) => {
      const rec = { id: nextId(), ...data };
      records(name).push(rec);
      return rec;
    }),
    bulkCreate: vi.fn(async (rows) => rows.map((d) => {
      const rec = { id: nextId(), ...d }; records(name).push(rec); return rec;
    })),
    bulkUpdate: vi.fn(async (rows) => (rows || []).map((u) => {
      const rec = records(name).find((r) => r.id === u.id);
      if (rec) Object.assign(rec, u);
      return rec || null;
    })),
    update: vi.fn(async (id, patch) => {
      const rec = records(name).find((r) => r.id === id);
      if (rec) Object.assign(rec, patch);
      return rec || null;
    }),
    updateMany: vi.fn(async () => ({ modified: 0 })),
    delete: vi.fn(async (id) => {
      const i = records(name).findIndex((r) => r.id === id);
      if (i >= 0) records(name).splice(i, 1);
      return true;
    }),
  };
}

const ENTITY_NAMES = [
  'TenantAccess', 'Lot', 'Property', 'User', 'Lease', 'RentDue',
  'Payment', 'Quittance', 'Transaction', 'BankTransaction', 'Impaye',
  'Incident', 'Alert', 'MonthClose', 'RentRevision', 'ChargeRegularization',
  'Holder', 'HolderMember', 'PropertyHolder', 'BankImport', 'BankRule',
  'Document', 'EmailLog', 'UserMilestone', 'AuditLog', 'PatrimonyMember',
  'Subscription', 'InvestmentScenario', 'DocumentImport',
];

export function makeClient({ seed = {}, user = null } = {}) {
  const store = new Map();
  const ensure = (e) => store.get(e) || store.set(e, []).get(e);
  const records = (e) => ensure(e);
  for (const [e, rows] of Object.entries(seed)) records(e).push(...rows);

  const entities = {};
  for (const name of ENTITY_NAMES) entities[name] = makeEntity(records, name);

  const sendEmail = vi.fn(async () => ({ ok: true }));

  const svc = {
    entities,
    integrations: { Core: { SendEmail: sendEmail, UploadFile: vi.fn(), InvokeLLM: vi.fn() } },
    auth: {
      me: async () => user,
      isAuthenticated: async () => !!user,
      updateMe: vi.fn(async (d) => { if (user) Object.assign(user, d); return user; }),
    },
    users: { inviteUser: vi.fn(async () => ({ ok: true })) },
  };

  return {
    _store: store,
    _records: records,
    _snapshot: () => Object.fromEntries([...store.entries()].map(([k, v]) => [k, [...v]])),
    asServiceRole: svc,
    entities: svc.entities,
    integrations: svc.integrations,
    auth: svc.auth,
    // helpers d'assertion
    find: (e, pred) => records(e).filter((r) => matchPred(r, pred)),
    all: (e) => [...records(e)],
  };
}