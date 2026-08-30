// Factory de fixtures volumineuses pour les tests de charge / performance.
//
// Génère EN MÉMOIRE une masse représentative d'un gros portefeuille locatif
// (50 biens, 200 lots, 800 baux, 20 000 transactions, 5 000 échéances, 500
// impayés, 2 000 alertes). Aucune écriture en base de production : les
// enregistrements ne vivent que dans le store mocké du harnais (serverContext)
// ou sont passés en direct aux moteurs purs (cockpitEngine).
//
// Chaque enregistrement respecte le schéma réel de son entité (champs requis
// + champs lus par les moteurs) pour ne pas planter le code testé.

const CITIES = ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Nantes', 'Lille', 'Toulouse', 'Nice'];
const STREETS = ['rue Lafayette', 'av. Jean Jaurès', 'bd Voltaire', 'rue Garibaldi',
  'rue Pasteur', 'av. de la République', 'rue Victor Hugo', 'rue du Port'];
const EXP_CATS = ['property_tax', 'condo_fees', 'pno_insurance', 'management_fees', 'maintenance_work'];
const ALERT_SOURCES = ['loyer_impaye', 'bail_expirant', 'dpe', 'assurance',
  'echeance_fiscale', 'ag_copropriete', 'echeance_credit', 'document_manquant'];
const PRIOS = ['information', 'a_traiter', 'important', 'urgent'];

const pad = (n) => String(n).padStart(2, '0');
const periodOf = (y, m) => `${y}-${pad(m)}`;
const iso = (d) => d.toISOString().slice(0, 10);

/**
 * Construit la masse de fixtures.
 * @param {{patrimonyId?: string, ownerEmail?: string, now?: Date, counts?: object}} opts
 * @returns {{properties, lots, leases, transactions, rentDues, impayes, alerts, patrimonyId, ownerEmail}}
 */
export function buildMassivePatrimony({
  patrimonyId = 'patrimo-load-1',
  ownerEmail = 'load@patrimo.test',
  now = new Date('2026-08-25T00:00:00Z'),
  counts = {
    properties: 50, lots: 200, activeLeases: 300, oldLeases: 500,
    transactions: 20000, rentDues: 5000, impayes: 500, alerts: 2000,
  },
} = {}) {
  const owner_id = ownerEmail;
  const today = iso(now);

  // ── Properties (50) — 1 bien sur 2 a un prêt 20 ans (portefeuille levier réaliste) ──
  const properties = [];
  for (let i = 0; i < counts.properties; i++) {
    const city = CITIES[i % CITIES.length];
    const id = `P${pad(i + 1)}`;
    const price = 120000 + (i % 20) * 25000;
    const hasLoan = i % 2 === 0;
    properties.push({
      id, owner_id, is_demo: false, patrimony_id: patrimonyId,
      name: `Immeuble ${city} ${pad(i + 1)}`,
      address: `${10 + i} ${STREETS[i % STREETS.length]}, ${city}`,
      city, property_type: i % 2 ? 'appartement' : 'immeuble',
      purchase_price: price,
      notary_fees: Math.round(price * 0.08),
      agency_fees: Math.round(price * 0.05),
      initial_works: 5000 + (i % 5) * 2000,
      estimated_value: price + 20000,
      holding_structure: i % 4 === 0 ? 'SCI' : 'PP',
      down_payment: Math.round(price * 0.1),
      loan_amount: hasLoan ? Math.round(price * 0.8) : 0,
      loan_rate: 3.5,
      loan_duration_years: 20,
      loan_start_date: hasLoan ? '2018-03-05' : null,
      loan_deferred_months: 0,
      monthly_payment: 0,           // mensualité théorique calculée par le moteur (chemin coûteux)
      monthly_insurance: hasLoan ? 45 : 0,
      pno_insurance: 300 + (i % 4) * 50,
      property_tax: 1200 + (i % 7) * 100,
      condo_fees: 800 + (i % 3) * 200,
      management_fees: 0, accountant_fees: 0, other_annual_charges: 0,
      updated_date: today,
    });
  }

  // ── Lots (200) — 4 lots / bien, ~10 % vacants ──
  const lots = [];
  for (let i = 0; i < counts.lots; i++) {
    const p = properties[i % counts.properties];
    const idx = Math.floor(i / counts.properties);
    const vacant = i % 10 === 0;
    lots.push({
      id: `L${pad(i + 1)}`, owner_id, is_demo: false,
      property_id: p.id,
      designation: `Lot ${pad(idx + 1)}`,
      is_vacant: vacant,
      rent_excluding_charges: 650 + (i % 8) * 50,
      charges: 60 + (i % 5) * 10,
      deposit: 1200,
      furnished: i % 3 === 0,
      dpe_class: ['A', 'B', 'C', 'D', 'E', 'F', 'G'][i % 7],
      dpe_date: '2022-06-01',
      tenant_name: vacant ? '' : `Locataire ${pad(i + 1)}`,
      tenant_email: vacant ? '' : `locataire${i}@mail.test`,
      tenant_entry_date: vacant ? '' : '2023-01-01',
      tenant_exit_date: '',
    });
  }

  // ── Leases (300 actifs + 500 anciens) — plusieurs baux par lot dans le temps ──
  const leases = [];
  const lotCount = lots.length;
  const mkLease = (i, active) => {
    const lot = lots[i % lotCount];
    const start = active ? `2020-${pad((i % 12) + 1)}-01` : `2014-${pad((i % 12) + 1)}-01`;
    const end = active ? (i % 4 === 0 ? '2030-12-31' : '') : `2019-${pad((i % 12) + 1)}-01`;
    return {
      id: active ? `LB-A${pad(i + 1)}` : `LB-T${pad(i + 1)}`,
      owner_id, is_demo: false,
      property_id: lot.property_id, lot_id: lot.id,
      lease_type: 'Vide-Nu',
      date_start: start,
      date_end: end || null,
      status: active ? 'actif' : 'termine',
      tenants: [{
        id: `T${pad(i + 1)}`, name: `Locataire ${pad(i + 1)}`,
        entry_date: start, exit_date: end || '', email: `locataire${i}@mail.test`,
      }],
      rent_excluding_charges: 650 + (i % 8) * 50,
      charges: 60 + (i % 5) * 10,
      deposit: 1200,
      due_day: 5,
      payment_frequency: 'mensuel',
      indexation_type: i % 4 === 0 ? 'IRL' : 'aucune',
      index_reference: 'T1 2020',
      index_value_initial: 130, index_value_current: 138,
      last_revision_date: '2024-01-01',
      next_revision_date: i % 4 === 0 ? '2026-01-01' : null,
      furnished: false, notes: '',
    };
  };
  for (let i = 0; i < counts.activeLeases; i++) leases.push(mkLease(i, true));
  for (let i = 0; i < counts.oldLeases; i++) leases.push(mkLease(i, false));

  // ── Transactions (20 000) — 400 / bien, réparties sur 2025-2026 ──
  const transactions = [];
  const txPerProp = Math.ceil(counts.transactions / counts.properties);
  let txi = 0;
  for (const p of properties) {
    for (let k = 0; k < txPerProp; k++) {
      const year = 2025 + (k % 2);
      const month = (k % 12) + 1;
      const isIncome = k % 4 === 0;
      const cat = isIncome ? 'rent' : EXP_CATS[k % EXP_CATS.length];
      const amount = isIncome ? 700 + (k % 5) * 30 : -(120 + (k % 9) * 20);
      transactions.push({
        id: `TX${pad(++txi)}`, owner_id, is_demo: false,
        property_id: p.id, lot_id: '',
        year, month, category: cat, category_label: cat,
        amount, type: isIncome ? 'income' : 'expense',
        note: '', bank_import_id: '', transfer_pair_id: '',
      });
    }
  }

  // ── RentDue (5 000) — liés aux baux actifs ──
  const rentDues = [];
  const activeLeases = leases.filter((l) => l.status === 'actif');
  const duesPerLease = Math.ceil(counts.rentDues / activeLeases.length);
  let rdi = 0;
  for (const l of activeLeases) {
    for (let k = 0; k < duesPerLease && rdi < counts.rentDues; k++) {
      const year = (k + 6) % 2 === 0 ? 2026 : 2025;
      const month = ((k + 3) % 12) + 1;
      const due = `${year}-${pad(month)}-05`;
      const total = (l.rent_excluding_charges || 0) + (l.charges || 0);
      const paid = k % 7 === 0 ? 0 : total;
      const status = paid === 0 ? 'unpaid' : paid < total ? 'partial' : 'paid';
      rentDues.push({
        id: `RD${pad(++rdi)}`, owner_id, is_demo: false,
        lease_id: l.id, property_id: l.property_id, lot_id: l.lot_id,
        year, month, period: periodOf(year, month), due_date: due,
        rent_excluding_charges: l.rent_excluding_charges, charges: l.charges,
        additional_amount: 0, total_due: total, paid_amount: paid, balance: total - paid,
        status, tenant_name: l.tenants[0].name, generated_date: due, notes: '',
      });
    }
  }

  // ── Impayés (500) — sur des échéances non soldées ──
  const impayes = [];
  const unpaidDues = rentDues.filter((rd) => rd.status === 'unpaid');
  for (let i = 0; i < counts.impayes && i < unpaidDues.length; i++) {
    const rd = unpaidDues[i];
    const late = 20 + (i % 60);
    impayes.push({
      id: `IM${pad(i + 1)}`, owner_id, is_demo: false,
      rent_due_id: rd.id, lease_id: rd.lease_id, lot_id: rd.lot_id, property_id: rd.property_id,
      tenant_name: rd.tenant_name, tenant_email: '', tenant_address: '',
      property_name: '', lot_designation: '',
      expected_amount: rd.total_due, initial_amount: rd.total_due, paid_amount: 0,
      missing_amount: rd.total_due, outstanding_amount: rd.total_due,
      year: rd.year, month: rd.month, period: rd.period,
      status: 'echeance_impayee',
      detected_date: rd.due_date, first_unpaid_date: rd.due_date, due_date: rd.due_date,
      late_days: late, last_relance_date: '', regularized_date: '', action_history: [], relance_history: [],
    });
  }

  // ── Alertes (2 000) ──
  const alerts = [];
  for (let i = 0; i < counts.alerts; i++) {
    const src = ALERT_SOURCES[i % ALERT_SOURCES.length];
    alerts.push({
      id: `AL${pad(i + 1)}`, owner_id, is_demo: false,
      source: src, linked_type: 'none', linked_id: '', linked_label: '',
      title: `Alerte ${src}`, message: `Message alerte ${i}`,
      date: `2026-${pad((i % 12) + 1)}-${pad((i % 27) + 1)}`,
      priority: PRIOS[i % PRIOS.length], status: 'active',
      recommended_action: '', action_url: '/', snooze_until: '', resolved_date: '',
      actor: ownerEmail, fingerprint: `fp|${src}|${i}`,
    });
  }

  return { patrimonyId, ownerEmail, properties, lots, leases, transactions, rentDues, impayes, alerts };
}

// ── Helpers de peuplement / nettoyage du store mocké (harnais serverContext) ──

/** Peuple le store in-memory d'un client mocké (makeClient) avec la masse. */
export function seedIntoStore(client, fixtures) {
  const rec = client._records;
  const map = {
    Property: fixtures.properties,
    Lot: fixtures.lots,
    Lease: fixtures.leases,
    Transaction: fixtures.transactions,
    RentDue: fixtures.rentDues,
    Impaye: fixtures.impayes,
    Alert: fixtures.alerts,
  };
  for (const [entity, rows] of Object.entries(map)) rec(entity).push(...rows);
}

/** Vide proprement le store in-memory (nettoyage en fin de test). */
export function clearStore(client) {
  for (const entity of client._store.keys()) client._records(entity).length = 0;
}