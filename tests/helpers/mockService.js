// Façade de service « in-memory » imitant base44.asServiceRole pour les tests
// d'intégration des moteurs (quittanceEngine, impayeEngine, import→Transaction).
//
// Seules les méthodes effectivement appelées par les moteurs sont implémentées.
// `filter` accepte un prédicat simple par égalité de champs.
export function makeMockService() {
  const store = new Map(); // entity -> array
  const ensure = (e) => store.get(e) || store.set(e, []).get(e);

  const records = (e) => ensure(e);

  return {
    _store: store,
    snapshot: () => {
      const out = {};
      for (const [e, rows] of store.entries()) out[e] = [...rows];
      return out;
    },
    entities: {
      Lease: entity(records, 'Lease'),
      Lot: entity(records, 'Lot'),
      Property: entity(records, 'Property'),
      RentDue: entity(records, 'RentDue'),
      Payment: entity(records, 'Payment'),
      Quittance: entity(records, 'Quittance'),
      Impaye: entity(records, 'Impaye'),
      Transaction: entity(records, 'Transaction'),
      BankTransaction: entity(records, 'BankTransaction'),
    },
  };
}

function entity(records, name) {
  return {
    list: async () => records(name),
    filter: async (pred = {}) => records(name).filter((r) => matchPred(r, pred)),
    get: async (id) => records(name).find((r) => r.id === id) || null,
    create: async (data) => {
      const rec = { id: `${name}-${records(name).length + 1}-${Math.random().toString(36).slice(2, 7)}`, ...data };
      records(name).push(rec);
      return rec;
    },
    update: async (id, patch) => {
      const rec = records(name).find((r) => r.id === id);
      if (rec) Object.assign(rec, patch);
      return rec;
    },
    delete: async (id) => {
      const i = records(name).findIndex((r) => r.id === id);
      if (i >= 0) records(name).splice(i, 1);
      return true;
    },
  };
}

function matchPred(r, pred) {
  return Object.entries(pred || {}).every(([k, v]) => r[k] === v);
}