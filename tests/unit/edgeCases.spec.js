/**
 * Edge cases pathologiques pour chaque moteur partagé.
 *
 * Objectif : verrouiller le comportement robuste face à des données « inattendues »
 * typiques d'un premier client B2B (dates bissextiles, données corrompues, montants
 * nuls, régimes inconnus, paiements exacts/en avance/excédent, gros volumes, fuseaux
 * horaires exotiques, prêts dégénérés). Les assertions décrivent le comportement
 * SÛR actuel (pas de NaN, pas de boucle infinie, pas de crash, replis déterministes) :
 * vert aujourd'hui, elles deviendraient rouges à la moindre régression.
 */
import { describe, it, expect } from 'vitest';
import {
  computeLeaseStatus,
  isLeaseActiveAt,
  pickActiveLease,
  pickLeaseForPeriod,
  legacyLotSnapshot,
} from '../../base44/shared/leaseResolve.ts';
import { buildEstimate, loanMonthlyPayment, loanSplitForYear, regimeOf } from '../../base44/shared/taxEngine.ts';
import { syncImpayesForLease, lateDays } from '../../base44/shared/impayeEngine.ts';
import { buildCalendarEvents } from '../../base44/shared/calendarEngine.ts';
import {
  computeMonthlyPayment,
  buildSchedule,
  scheduleTotals,
} from '../../base44/shared/loanEngine.ts';

// ----------------------------------------------------------------------------
// leaseResolve
// ----------------------------------------------------------------------------
describe("edgeCases — leaseResolve", () => {
  it("bail démarré le 29/02 (année bissextile) : statut cohérent, pas de crash de date", () => {
    const lease = { id: 'l', date_start: '2024-02-29' };
    expect(computeLeaseStatus(lease, '2024-06-15')).toBe('actif');
    expect(isLeaseActiveAt(lease, '2024-06-15')).toBe(true);
    // La période de fév. 2024 est bien couverte.
    expect(pickLeaseForPeriod([lease], 2024, 2)?.id).toBe('l');
    // Comparaison lexicale ISO : pas de glissement de jour.
    expect(lateDays('2024-02-29', '2024-03-01')).toBe(1);
  });

  it("donnée corrompue date_end < date_start : traitée comme terminée, jamais active", () => {
    const lease = { id: 'c', date_start: '2024-06-01', date_end: '2024-05-01' };
    expect(() => computeLeaseStatus(lease, '2024-06-15')).not.toThrow();
    expect(computeLeaseStatus(lease, '2024-06-15')).toBe('termine');
    expect(isLeaseActiveAt(lease, '2024-06-15')).toBe(false);
    expect(pickActiveLease([lease], '2024-06-15')).toBeNull();
  });

  it("bail sans locataire (tenants=[]) : snapshot vacant propre, sans crash", () => {
    const lot = { designation: 'Appart. 1', rent_excluding_charges: 800, charges: 50 };
    const snap = legacyLotSnapshot(lot, { name: 'Immeuble' });
    expect(Array.isArray(snap.tenants)).toBe(true);
    expect(snap.tenants).toHaveLength(0);
    expect(snap.tenant_name).toBe('');
    expect(snap.status).toBe('actif');
    expect(snap.rent_excluding_charges).toBe(800);
  });

  it("deux bails chevauchant exactement la même période : résolution déterministe (un seul, le plus récent)", () => {
    const leases = [
      { id: 'first', date_start: '2024-01-01', tenants: [{ name: 'A' }] },
      { id: 'second', date_start: '2024-01-15', tenants: [{ name: 'B' }] },
    ];
    const picked = pickLeaseForPeriod(leases, 2024, 3);
    expect(picked).not.toBeNull();
    expect(picked.id).toBe('second');
  });
});

// ----------------------------------------------------------------------------
// taxEngine
// ----------------------------------------------------------------------------
describe("edgeCases — taxEngine", () => {
  const prop = (tax_regime) => ({ id: 'p1', name: 'Studio', tax_regime });

  it("transaction à montant 0 : aucun NaN, base nulle", () => {
    const est = buildEstimate({
      property: prop('Location nue (micro-foncier)'),
      transactions: [{ type: 'income', category: 'rent', amount: 0 }],
      year: 2025,
    });
    const allNums = [est.revenue, est.deductibleCharges, est.interest, est.amortissement, est.taxableBase, est.tax];
    for (const n of allNums) expect(Number.isNaN(n)).toBe(false);
    expect(est.revenue).toBe(0);
    expect(est.taxableBase).toBe(0);
    expect(est.tax).toBe(0);
  });

  it("année sans aucune transaction : estimation nulle, pas d'erreur", () => {
    const est = buildEstimate({ property: prop('Location nue (revenus fonciers)'), transactions: [], year: 2025 });
    expect(est.unsupported).toBe(false);
    expect(est.revenue).toBe(0);
    expect(est.taxableBase).toBe(0);
    expect(Array.isArray(est.lines)).toBe(true);
    expect(Array.isArray(est.hypotheses)).toBe(true);
  });

  it("régime fiscal inconnu : bascule en non géré explicite (warning), base nulle", () => {
    const cap = regimeOf('Régime inexistant 404');
    expect(cap.kind).toBe('custom');
    const est = buildEstimate({ property: prop('Régime inexistant 404'), transactions: [], year: 2025 });
    expect(est.unsupported).toBe(true);
    expect(est.taxableBase).toBe(0);
    expect(est.tax).toBe(0);
    expect(est.hypotheses.some((h) => /non géré/i.test(h))).toBe(true);
  });

  it("amortissement avec prix_achat=0 : jamais de division par zéro", () => {
    expect(loanMonthlyPayment({ loan_amount: 0, loan_rate: 3, loan_duration_years: 15 })).toBeNull();
    const split = loanSplitForYear({ loan_amount: 0, loan_rate: 3, loan_duration_years: 15, loan_start_date: '2025-01-01' }, 2025);
    expect(split.interest).toBe(0);
    expect(split.principal).toBe(0);
    expect(Number.isNaN(split.interest)).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// impayeEngine (via syncImpayesForLease + mémoire in-memory)
// ----------------------------------------------------------------------------
function mockSvc({ rentDues = [], impayes = [], lease = null, lot = null, property = null } = {}) {
  const store = { RentDue: [...rentDues], Impaye: [...impayes] };
  const matches = (rec, q) => !q || Object.entries(q).every(([k, v]) => rec[k] === v);
  return {
    _store: store,
    entities: {
      RentDue: {
        filter: async (q) => store.RentDue.filter((r) => matches(r, q)),
        get: async (id) => store.RentDue.find((r) => r.id === id) || null,
      },
      Impaye: {
        filter: async (q) => store.Impaye.filter((i) => matches(i, q)),
        create: async (d) => { const rec = { id: `imp-${store.Impaye.length + 1}`, ...d, status: d.status || 'echeance_impayee' }; store.Impaye.push(rec); return rec; },
        update: async (id, patch) => { const r = store.Impaye.find((i) => i.id === id); if (r) Object.assign(r, patch); return r; },
      },
      Lease: { get: async () => lease },
      Lot: { get: async () => lot },
      Property: { get: async () => property },
    },
  };
}

describe("edgeCases — impayeEngine", () => {
  const due = (over) => ({
    id: 'rd1', lease_id: 'L1', lot_id: 'lot1', property_id: 'p1', owner_id: 'a@b',
    year: 2026, month: 8, period: '2026-08', tenant_name: 'Loc. A', total_due: 700,
    due_date: '2026-08-05', ...over,
  });

  it("paiement EXACTEMENT égal au montant dû → régularisé (payé), pas partiel", async () => {
    const svc = mockSvc({
      rentDues: [due({ paid_amount: 700, status: 'paid' })],
      impayes: [{ id: 'imp0', rent_due_id: 'rd1', lease_id: 'L1', status: 'echeance_impayee', outstanding_amount: 700 }],
      lease: { id: 'L1', tenants: [{ name: 'Loc. A' }] }, lot: { id: 'lot1' }, property: { id: 'p1' },
    });
    const res = await syncImpayesForLease(svc, 'L1', '2026-08-25');
    expect(res.regularized).toBe(1);
    expect(svc._store.Impaye[0].status).toBe('régularisé');
    expect(svc._store.Impaye[0].missing_amount).toBe(0);
    expect(svc._store.Impaye[0].outstanding_amount).toBe(0);
  });

  it("échéance en avance (mois suivant non échue) : aucun impayé créé prématurément", async () => {
    const svc = mockSvc({
      rentDues: [due({ paid_amount: 0, due_date: '2026-09-05', month: 9, period: '2026-09', status: 'unpaid' })],
      lease: { id: 'L1', tenants: [{ name: 'Loc. A' }] }, lot: { id: 'lot1' }, property: { id: 'p1' },
    });
    const res = await syncImpayesForLease(svc, 'L1', '2026-08-25');
    expect(res.created).toBe(0);
    expect(svc._store.Impaye).toHaveLength(0);
  });

  it("paiement > montant dû : excédent ne produit jamais de solde négatif", async () => {
    const svc = mockSvc({
      rentDues: [due({ paid_amount: 800, total_due: 700, status: 'overpaid' })],
      impayes: [{ id: 'imp0', rent_due_id: 'rd1', lease_id: 'L1', status: 'echeance_impayee', outstanding_amount: 700 }],
      lease: { id: 'L1', tenants: [{ name: 'Loc. A' }] }, lot: { id: 'lot1' }, property: { id: 'p1' },
    });
    await syncImpayesForLease(svc, 'L1', '2026-08-25');
    const imp = svc._store.Impaye[0];
    expect(imp.status).toBe('régularisé');
    expect(imp.outstanding_amount).toBeGreaterThanOrEqual(0);
    expect(imp.missing_amount).toBe(0); // jamais négatif
  });

  it("locataire supprimé en cours de mois : l'impayé reste, snapshot du nom conservé", async () => {
    const svc = mockSvc({
      rentDues: [due({ paid_amount: 0, tenant_name: 'Ancien Loc.', status: 'unpaid' })],
      lease: { id: 'L1', tenants: [] }, // locataire retiré
      lot: { id: 'lot1', designation: 'Appart 1' }, property: { id: 'p1', name: 'Immeuble' },
    });
    const res = await syncImpayesForLease(svc, 'L1', '2026-08-25');
    expect(res.created).toBe(1);
    const imp = svc._store.Impaye[0];
    expect(imp.tenant_name).toBe('Ancien Loc.'); // nom conservé via snapshot de l'échéance
    expect(imp.tenant_email).toBe(''); // email vidé (locataire parti) — pas de crash
    expect(imp.outstanding_amount).toBe(700);
  });
});

// ----------------------------------------------------------------------------
// calendarEngine
// ----------------------------------------------------------------------------
describe("edgeCases — calendarEngine", () => {
  it("from > to : tableau vide, jamais d'erreur", () => {
    const evts = buildCalendarEvents({ rentDues: [{ id: 'rd', due_date: '2026-08-15' }] }, { from: '2026-08-31', to: '2026-08-01' });
    expect(Array.isArray(evts)).toBe(true);
    expect(evts).toHaveLength(0);
  });

  it("snoozedUntil dans le passé : l'événement réapparaît (non snoozé)", () => {
    const evts = buildCalendarEvents(
      { alerts: [{ id: 'a1', status: 'snoozed', snooze_until: '2020-01-01', date: '2026-08-10', title: 'Alerte', priority: 'a_traiter' }] },
      { from: '2026-08-01', to: '2026-08-31', now: '2026-08-25' },
    );
    const a = evts.find((e) => e.category === 'alert');
    expect(a).toBeTruthy();
    expect(a.snoozed).toBe(false);
  });

  it("10 000 événements dans la fenêtre : réponse en moins de 500 ms", () => {
    const rentDues = Array.from({ length: 10000 }, (_, i) => ({ id: `rd-${i}`, due_date: '2026-08-15', period: '2026-08' }));
    // Juillet déjà clos => aucun événement month_close parasite, on mesure 10 000 purs.
    const monthCloses = [{ period: '2026-07', status: 'closed' }];
    const t0 = performance.now();
    const evts = buildCalendarEvents({ rentDues, monthCloses }, { from: '2026-08-01', to: '2026-08-31', now: '2026-08-25' });
    const elapsed = performance.now() - t0;
    expect(evts.length).toBe(10000);
    expect(elapsed).toBeLessThan(500);
  });

  it("fuseau horaire client Pacifique/Auckland : les dates restent cohérentes (ancrage UTC)", () => {
    const prevTZ = process.env.TZ;
    process.env.TZ = 'Pacific/Auckland';
    try {
      const evts = buildCalendarEvents(
        { rentDues: [{ id: 'rd', due_date: '2026-08-15', period: '2026-08', tenant_name: 'X', status: 'unpaid' }] },
        { from: '2026-08-01', to: '2026-08-31', now: '2026-08-15' },
      );
      const e = evts.find((x) => x.category === 'rent_due');
      expect(e).toBeTruthy();
      expect(e.date).toBe('2026-08-15'); // pas de glissement ±1 jour
    } finally {
      process.env.TZ = prevTZ;
    }
  });
});

// ----------------------------------------------------------------------------
// loanEngine
// ----------------------------------------------------------------------------
describe("edgeCases — loanEngine", () => {
  it("taux 0 % : mensualité linéaire, aucun NaN ni Infinity", () => {
    const loan = { loan_amount: 120000, loan_rate: 0, loan_duration_years: 10, loan_start_date: '2025-01-05' };
    const M = computeMonthlyPayment(loan);
    expect(Number.isFinite(M)).toBe(true);
    expect(M).toBeCloseTo(1000, 2); // 120000 / 120
    const sched = buildSchedule(loan);
    const totals = scheduleTotals(sched);
    expect(Number.isNaN(totals.totalInterest)).toBe(false);
    expect(totals.totalInterest).toBe(0);
    expect(totals.totalPrincipal).toBe(120000);
  });

  it("durée 0 mois : pas de boucle infinie, sortie vide (erreur maîtrisée)", () => {
    const loan = { loan_amount: 100000, loan_rate: 3, loan_duration_years: 0, loan_start_date: '2025-01-05' };
    expect(computeMonthlyPayment(loan)).toBe(0);
    const sched = buildSchedule(loan);
    expect(Array.isArray(sched)).toBe(true);
    expect(sched).toHaveLength(0); // terminaison immédiate, pas de boucle
  });

  it("différé > durée totale : borné, se termine, jamais de boucle infinie", () => {
    const loan = { loan_amount: 100000, loan_rate: 0, loan_duration_years: 5, loan_start_date: '2025-01-05', loan_deferred_months: 120 };
    const sched = buildSchedule(loan);
    expect(sched.length).toBeGreaterThan(0);
    expect(sched.length).toBeLessThan(1000); // borné, pas de fuite
    expect(sched[sched.length - 1].remaining).toBe(0); // prêt bien soldé
    const totals = scheduleTotals(sched);
    expect(totals.totalPrincipal).toBe(100000);
  });

  it("prêt en devise étrangère (champ ignoré) : calcul inchangé, pas de crash", () => {
    const loan = { loan_amount: 100000, loan_rate: 3, loan_duration_years: 15, loan_start_date: '2025-01-05', currency: 'USD' };
    const sched = buildSchedule(loan);
    expect(sched.length).toBe(180);
    const totals = scheduleTotals(sched);
    expect(Number.isFinite(totals.totalInterest)).toBe(true);
    expect(sched[0].beginCapital).toBe(100000);
  });
});