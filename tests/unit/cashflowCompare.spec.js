import { describe, it, expect } from 'vitest';
import { computeCashflowCompare, monthsForPeriod, periodLabel } from '../../base44/shared/cashflowCompare.ts';

// Bien type : prêt 120k @2,5% sur 15 ans, assurance 25€/mois.
const property = (over = {}) => ({
  id: 'prop-1',
  purchase_price: 180000,
  notary_fees: 14000,
  agency_fees: 6000,
  initial_works: 0,
  loan_amount: 120000,
  loan_rate: 2.5,
  loan_duration_years: 15,
  loan_start_date: '2024-01-05',
  monthly_insurance: 25,
  ...over,
});

// Bail actif couvrant 2026 : loyer HC 700 + charges 50 = 750€/mois attendus.
const lease = (over = {}) => ({
  id: 'lease-1',
  property_id: 'prop-1',
  lot_id: 'lot-1',
  date_start: '2024-09-01',
  date_end: null,
  rent_excluding_charges: 700,
  charges: 50,
  ...over,
});

const tx = (month, category, amount, type, extra = {}) => ({
  property_id: 'prop-1',
  year: 2026,
  month,
  category,
  amount,
  type,
  ...extra,
});

const MONTH = { kind: 'month', year: 2026, month: 8 };

describe('cashflowCompare — réel vs théorique', () => {
  it('cash-flow théorique (aucune transaction)', () => {
    const res = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions: [], period: MONTH });
    expect(res.theoretical.rent_income).toBe(750); // 700 + 50
    expect(res.theoretical.debt_service).toBeGreaterThan(0); // loanEngine théorique + assurance 25
    expect(res.theoretical.planned_charges).toBe(0);
    expect(res.theoretical.net).toBeCloseTo(750 - res.theoretical.debt_service, 0);
    expect(res.real.net).toBe(0);
    expect(res.period.coverageMonths).toBe(0);
    expect(res.period.partial).toBe(true); // 0 mois de banque sur 1 → partiel
  });

  it('cash-flow réel (transactions validées)', () => {
    const schedDebt = res => res.theoretical.debt_service;
    const res0 = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions: [], period: MONTH });
    const installment = schedDebt(res0) - 25; // debt théorique = installment + assurance 25
    const transactions = [
      tx(8, 'rent', 750, 'income'),
      tx(8, 'loan_installment', installment, 'expense'),
      tx(8, 'loan_insurance', 25, 'expense'),
    ];
    const res = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions, period: MONTH });
    expect(res.real.rent_income).toBe(750);
    expect(res.real.debt_service).toBeCloseTo(installment + 25, 0);
    expect(res.real.operating_expenses).toBe(0);
    expect(res.real.net).toBeCloseTo(750 - (installment + 25), 0);
    expect(res.period.coverageMonths).toBe(1);
    expect(res.period.complete).toBe(true);
  });

  it('écart nul quand le réel correspond à la prévision', () => {
    const res0 = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions: [], period: MONTH });
    const installment = res0.theoretical.debt_service - 25;
    const transactions = [
      tx(8, 'rent', 750, 'income'),
      tx(8, 'loan_installment', installment, 'expense'),
      tx(8, 'loan_insurance', 25, 'expense'),
    ];
    const res = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions, period: MONTH });
    expect(res.variance.total).toBeCloseTo(0, 0);
    expect(res.variance.items.length).toBe(0);
  });

  it('paiement partiel — loyer manquant remonté dans l’écart', () => {
    const res0 = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions: [], period: MONTH });
    const installment = res0.theoretical.debt_service - 25;
    const transactions = [
      tx(8, 'rent', 400, 'income'), // partiel : 400 / 750 attendus
      tx(8, 'loan_installment', installment, 'expense'),
      tx(8, 'loan_insurance', 25, 'expense'),
    ];
    const res = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions, period: MONTH });
    expect(res.real.rent_income).toBe(400);
    const missing = res.variance.items.find((i) => i.kind === 'missing_rent');
    expect(missing).toBeDefined();
    expect(missing.amount).toBe(-350); // 400 - 750
    expect(res.variance.total).toBe(-350);
  });

  it('dépense exceptionnelle — travaux isolés de l’écart', () => {
    const res0 = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions: [], period: MONTH });
    const installment = res0.theoretical.debt_service - 25;
    const transactions = [
      tx(8, 'rent', 750, 'income'),
      tx(8, 'loan_installment', installment, 'expense'),
      tx(8, 'loan_insurance', 25, 'expense'),
      tx(8, 'works', 500, 'expense'), // dépense exceptionnelle
    ];
    const res = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions, period: MONTH });
    const exc = res.variance.items.find((i) => i.kind === 'exceptional_expense');
    expect(exc).toBeDefined();
    expect(exc.amount).toBe(-500);
    const higher = res.variance.items.find((i) => i.kind === 'higher_charges');
    expect(higher).toBeUndefined(); // pas de charges récurrentes
    expect(res.variance.total).toBeCloseTo(-500, 0);
  });

  it('fiscalité — IS/IR et TVA exclus du cash-flow (pas d’effet sur l’écart)', () => {
    const res0 = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions: [], period: MONTH });
    const installment = res0.theoretical.debt_service - 25;
    const transactions = [
      tx(8, 'rent', 750, 'income'),
      tx(8, 'loan_installment', installment, 'expense'),
      tx(8, 'loan_insurance', 25, 'expense'),
      tx(8, 'tax_income', 1000, 'expense'), // IS — exclu du cash-flow
      tx(8, 'vat', 200, 'expense'),          // TVA — exclue
    ];
    const res = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions, period: MONTH });
    expect(res.real.operating_expenses).toBe(0); // ni IS ni TVA dans l'exploitation
    expect(res.real.debt_service).toBeCloseTo(installment + 25, 0);
    expect(res.variance.total).toBeCloseTo(0, 0); // aucun écart lié aux taxes
    expect(res.variance.items.length).toBe(0);
  });

  it('année partielle — annualisation basée sur la couverture bancaire + flag', () => {
    const period = { kind: 'year', year: 2026 };
    const res0 = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions: [], period });
    const installment = res0.theoretical.debt_service / 12 - 25 / 12; // mensuel théorique (annualisé /12)
    // approximation : on recale sur le mensuel théorique
    const thMonthly = res0.theoretical.debt_service / 12;
    const transactions = [
      tx(7, 'rent', 750, 'income'),
      tx(7, 'loan_installment', thMonthly - 25, 'expense'),
      tx(7, 'loan_insurance', 25, 'expense'),
      tx(8, 'rent', 750, 'income'),
      tx(8, 'loan_installment', thMonthly - 25, 'expense'),
      tx(8, 'loan_insurance', 25, 'expense'),
    ];
    const res = computeCashflowCompare({ properties: [property()], leases: [lease()], transactions, period });
    expect(res.period.monthsCount).toBe(12);
    expect(res.period.coverageMonths).toBe(2);
    expect(res.period.partial).toBe(true);
    expect(res.period.complete).toBe(false);
    expect(res.performance.real.annualized).toBe(true);
    expect(res.performance.real.basisMonths).toBe(2);
    // annualisation = somme réelle × 12 / 2 (couverture)
    const sumRealNet = res.real.net; // déjà agrégé sur les 2 mois couverts
    expect(res.performance.real.netYield).toBeCloseTo((sumRealNet * 12 / 2) / (property().purchase_price + 14000 + 6000) * 100, 0);
  });
});

describe('cashflowCompare — périodes & labels', () => {
  it('monthsForPeriod — month / year / ytd / t12m', () => {
    expect(monthsForPeriod(MONTH)).toEqual([{ year: 2026, month: 8 }]);
    expect(monthsForPeriod({ kind: 'year', year: 2026 }).length).toBe(12);
    expect(monthsForPeriod({ kind: 'ytd', year: 2026, asOf: '2026-08-15' }).length).toBe(8);
    expect(monthsForPeriod({ kind: 't12m', year: 2026, asOf: '2026-08-15' }).length).toBe(12);
    const t12m = monthsForPeriod({ kind: 't12m', year: 2026, asOf: '2026-08-15' });
    expect(t12m[0]).toEqual({ year: 2025, month: 9 });
    expect(t12m[t12m.length - 1]).toEqual({ year: 2026, month: 8 });
  });

  it('periodLabel — mois / année / ytd / 12m', () => {
    expect(periodLabel(MONTH)).toContain('Août');
    expect(periodLabel({ kind: 'year', year: 2026 })).toContain('2026');
    expect(periodLabel({ kind: 'ytd', year: 2026, asOf: '2026-08-15' })).toContain('Août');
    expect(periodLabel({ kind: 't12m', year: 2026, asOf: '2026-08-15' })).toContain('→');
  });
});