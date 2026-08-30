import { describe, it, expect } from 'vitest';
import {
  computeAcquisitionCost, computePropertyPerformance, computePortfolioPerformance,
  getPerformanceBreakdown,
} from '@/lib/performanceEngine';

// ── Dataset factice partagé (mêmes loyers & charges pour tous les cas) ────────
const baseProperty = {
  id: 'p1', name: 'Studio Lyon', category: 'Appartement',
  purchase_price: 100000, notary_fees: 9000, agency_fees: 0, initial_works: 1000,
  property_tax: 800, pno_insurance: 200, condo_fees: 600, management_fees: 360,
  accountant_fees: 0, other_annual_charges: 0,
};
const lots = [{ id: 'l1', property_id: 'p1', designation: 'Studio', is_vacant: false }];
const leases = [
  { id: 'le1', lot_id: 'l1', date_start: '2020-01-01', status: 'actif', rent_excluding_charges: 600, charges: 0 },
];

const txNoLoan = Array.from({ length: 12 }, (_, i) => ({
  property_id: 'p1', year: 2025, month: i + 1, type: 'income', category: 'rent', amount: 600,
}));
const txWithLoan = [
  ...txNoLoan,
  ...Array.from({ length: 12 }, (_, i) => ({
    property_id: 'p1', year: 2025, month: i + 1, type: 'expense', category: 'loan_installment', amount: 450,
  })),
  ...Array.from({ length: 12 }, (_, i) => ({
    property_id: 'p1', year: 2025, month: i + 1, type: 'expense', category: 'loan_insurance', amount: 30,
  })),
];

const NO_LOAN = computePropertyPerformance({ property: baseProperty, transactions: txNoLoan, year: 2025, leases, lots });
const WITH_LOAN = computePropertyPerformance({
  property: { ...baseProperty, loan_amount: 80000, down_payment: 30000, monthly_payment: 450, monthly_insurance: 30, loan_start_date: '2020-01-01', loan_rate: 3, loan_duration_years: 20 },
  transactions: txWithLoan, year: 2025, leases, lots,
});

describe("performanceEngine — coût d\u2019acquisition", () => {
  it("computeAcquisitionCost : achat + notaire + agence (acquisition) + travaux", () => {
    const ac = computeAcquisitionCost(baseProperty);
    expect(ac.total).toBe(110000);
    expect(ac.components).toEqual({
      purchase_price: 100000, notary_fees: 9000, acquisition_agency_fees: 0, initial_works: 1000,
    });
  });
});

describe("performanceEngine — rentabilité identique avec ou sans prêt", () => {
  it("netYield = NOI / coût (le crédit n\u2019est JAMAIS soustrait)", () => {
    expect(NO_LOAN.netYield).toBe(4.76);
    expect(WITH_LOAN.netYield).toBe(4.76);
  });
  it("grossYield = loyer / coût (identique avec/sans prêt)", () => {
    expect(NO_LOAN.grossYield).toBe(6.55);
    expect(WITH_LOAN.grossYield).toBe(6.55);
  });
  it("le prêt modifie cash-flow MAIS PAS netYield", () => {
    expect(NO_LOAN.theoreticalCashflow).toBe(5240);
    expect(WITH_LOAN.theoreticalCashflow).toBe(-520);
    expect(WITH_LOAN.actualCashflow).toBe(1440);
    expect(WITH_LOAN.netYield).toBe(NO_LOAN.netYield);
  });
  it("cash-on-cash dépend du capital investi (apport)", () => {
    // Sans prêt : cash-flow réel = loyers encaissés (7200) / apport = coût 110000 → 6,55 %.
    expect(NO_LOAN.cashOnCash).toBe(6.55);
    expect(WITH_LOAN.cashOnCash).toBe(4.8);
  });
});

describe("performanceEngine — cohérence multi-écrans (1 source)", () => {
  it("computePortfolioPerformance (1 bien) = computePropertyPerformance (même rentabilité nette)", () => {
    const pf = computePortfolioPerformance({ properties: [baseProperty], transactions: txNoLoan, year: 2025, leases, lots });
    expect(pf.netYield).toBe(NO_LOAN.netYield);
    expect(pf.grossYield).toBe(NO_LOAN.grossYield);
    expect(pf.acquisitionCost).toBe(NO_LOAN.acquisitionCost.total);
  });
  it("le rendement net-nette sans impôt fourni = null (non arbitré)", () => {
    expect(NO_LOAN.netNetYield).toBeNull();
    const withTax = computePropertyPerformance({ property: baseProperty, transactions: txNoLoan, year: 2025, leases, lots, taxAmount: 1000 });
    // (NOI 5240 − impôt 1000) / 110000 × 100 = 3,8545… arrondi à 3,85.
    expect(withTax.netNetYield).toBe(3.85);
  });
});

describe("performanceEngine — explicabilité", () => {
  it("getPerformanceBreakdown expose formule + valeurs + étapes", () => {
    const bd = getPerformanceBreakdown(WITH_LOAN, 'netYield');
    expect(bd.formula).toMatch(/NOI/);
    expect(bd.values.noi).toBe(5240);
    expect(bd.steps.some((s) => /NOI =/.test(s))).toBe(true);
    expect(bd.text).toContain('crédit');
  });
  it("la complétude signale les données manquantes", () => {
    expect(NO_LOAN.completeness).toBeGreaterThan(0);
    expect(NO_LOAN.completenessFlags).toContain('fiscalité manquante — net-nette non calculée (à compléter)');
  });
});

// ── Fiscalité : nette-nette sans présenter une estimation comme certaine ─────
describe("performanceEngine — fiscalité (tax_actual / tax_estimated / tax_status)", () => {
  // Dataset : un bien RNF (revenus fonciers au réel) — régime DOIT être confirmé.
  const prop = (tax_regime, extra = {}) => ({ ...baseProperty, tax_regime, ...extra });
  const rentTx = Array.from({ length: 12 }, (_, i) => ({
    property_id: 'p1', year: 2025, month: i + 1, type: 'income', category: 'rent', amount: 600,
  }));
  const expenseTx = (category, amount) => Array.from({ length: 12 }, (_, i) => ({
    property_id: 'p1', year: 2025, month: i + 1, type: 'expense', category, amount,
  }));

  it("fiscalité réelle : impôt payé (tax_income) → tax_status 'actual', netNet calculé", () => {
    const perf = computePropertyPerformance({
      property: prop('Location nue (revenus fonciers)'),
      transactions: [...rentTx, ...expenseTx('tax_income', 1000)], year: 2025, leases, lots,
    });
    expect(perf.tax_status).toBe('actual');
    expect(perf.tax_actual).toBe(12000);
    expect(perf.afterTaxIncome).toBe(perf.operatingIncome.netOperatingIncome - 12000);
    // netNetYield = afterTaxIncome / acquisitionCost × 100 (arrondi à 2 décimales).
    expect(perf.netNetYield).toBeCloseTo((perf.afterTaxIncome / perf.acquisitionCost.total) * 100, 2);
  });

  it("estimation : SCI à l'IS (moteur supporté) → tax_status 'estimated', sans Impôt réellement payé", () => {
    // SCI à l'IS : résultat fortement positif → IS estimé par le moteur (calcIS).
    const sciTx = [
      ...Array.from({ length: 12 }, (_, i) => ({ property_id: 'p1', year: 2025, month: i + 1, type: 'income', category: 'rent', amount: 2000 })),
      ...Array.from({ length: 12 }, (_, i) => ({ property_id: 'p1', year: 2025, month: i + 1, type: 'expense', category: 'property_tax', amount: 100 })),
      // Pas de transaction tax_income : aucun impôt réellement payé.
    ];
    const perf = computePropertyPerformance({
      property: prop("SCI à l'IS", { loan_amount: 0, down_payment: 110000, loan_rate: 0, loan_duration_years: 0, loan_start_date: null }),
      transactions: sciTx, year: 2025, leases, lots,
    });
    expect(perf.tax_status).toBe('estimated');
    expect(perf.tax_actual).toBe(0);
    expect(perf.tax_estimated).toBeGreaterThan(0);
    expect(perf.afterTaxIncome).toBe(perf.operatingIncome.netOperatingIncome - perf.tax_estimated);
  });

  it("fiscalité manquante : aucun impôt réel ni estimable → tax_status 'incomplete', netNet null", () => {
    const perf = computePropertyPerformance({
      property: prop('Location nue (revenus fonciers)'),
      transactions: rentTx, year: 2025, leases, lots,
    });
    expect(perf.tax_status).toBe('incomplete');
    expect(perf.tax_actual).toBe(0);
    expect(perf.tax_estimated).toBe(0);
    expect(perf.netNetYield).toBeNull();
    expect(perf.afterTaxIncome).toBeNull();
    expect(perf.taxOrigin).toMatch(/non renseigné|régime IR/i);
  });

  it("SCI à l'IR : régime IR non estimable (pas de TMI) → 'incomplete' (aucune hypothèse auto)", () => {
    const perf = computePropertyPerformance({
      property: prop("SCI à l'IR", { loan_amount: 0, down_payment: 110000, loan_rate: 0, loan_duration_years: 0, loan_start_date: null }),
      transactions: rentTx, year: 2025, leases, lots,
    });
    expect(perf.tax_status).toBe('incomplete');
    expect(perf.tax_estimated).toBe(0);
    expect(perf.netNetYield).toBeNull();
  });

  it("LMNP au réel : régime BIC réel non estimable (pas de TMI) → 'incomplete' (moteur non supporté pour le montant)", () => {
    const perf = computePropertyPerformance({
      property: prop('LMNP au réel'),
      transactions: rentTx, year: 2025, leases, lots,
    });
    expect(perf.tax_status).toBe('incomplete');
    expect(perf.tax_estimated).toBe(0);
    expect(perf.netNetYield).toBeNull();
  });

  it("LMNP au micro-BIC : micro → taxableBase mais aucun montant d'impôt → 'incomplete'", () => {
    const perf = computePropertyPerformance({
      property: prop('LMNP au micro-BIC'),
      transactions: rentTx, year: 2025, leases, lots,
    });
    expect(perf.tax_status).toBe('incomplete');
    expect(perf.tax_estimated).toBe(0);
  });

  it("régime inconnu : aucune hypothèse automatique — 'incomplete', aucune déduction SCI=IR / meublé=LMNP", () => {
    const perf = computePropertyPerformance({
      property: prop('Non renseigné'),
      transactions: rentTx, year: 2025, leases, lots,
    });
    expect(perf.tax_status).toBe('incomplete');
    expect(perf.tax_estimated).toBe(0);
    expect(perf.taxOrigin).toMatch(/non géré|estimation impossible/i);
  });

  it("impôt saisi manuellement (taxAmount) → 'actual', prioritaire sur le moteur", () => {
    const perf = computePropertyPerformance({
      property: prop('Location nue (revenus fonciers)'),
      transactions: rentTx, year: 2025, leases, lots, taxAmount: 800,
    });
    expect(perf.tax_status).toBe('actual');
    expect(perf.tax_actual).toBe(0); // aucune transaction tax_income
    expect(perf.afterTaxIncome).toBe(perf.operatingIncome.netOperatingIncome - 800);
    expect(perf.netNetYield).toBeCloseTo((perf.afterTaxIncome / perf.acquisitionCost.total) * 100, 2);
  });

  it("impôt réel prioritaire sur estimation (IS avec tax_income réellement payé)", () => {
    const sciTx = [
      ...Array.from({ length: 12 }, (_, i) => ({ property_id: 'p1', year: 2025, month: i + 1, type: 'income', category: 'rent', amount: 2000 })),
      ...expenseTx('tax_income', 800), // IS réellement payé
    ];
    const perf = computePropertyPerformance({
      property: prop("SCI à l'IS", { loan_amount: 0, down_payment: 110000, loan_rate: 0, loan_duration_years: 0, loan_start_date: null }),
      transactions: sciTx, year: 2025, leases, lots,
    });
    expect(perf.tax_status).toBe('actual');
    expect(perf.tax_actual).toBe(9600);
    // l'estimé reste calculé (info) mais non retenu.
    expect(perf.tax_estimated).toBeGreaterThan(0);
    expect(perf.afterTaxIncome).toBe(perf.operatingIncome.netOperatingIncome - 9600);
  });
});