import { describe, it, expect } from 'vitest';
import { computePropertyCashflow, computePortfolioCashflow } from '../../base44/shared/financeEngine.ts';

const property = (over = {}) => ({
  id: 'prop-1',
  loan_amount: 120000,
  loan_rate: 2.5,
  loan_duration_years: 15,
  loan_start_date: '2024-01-05',
  monthly_insurance: 25,
  ...over,
});

const tx = (month, category, amount, type, extra = {}) => ({
  property_id: 'prop-1',
  year: 2024,
  month,
  category,
  amount,
  type,
  ...extra,
});

describe('financeEngine — cash-flow canonique', () => {
  it('revenus d’exploitation + charges + service de la dette + net', () => {
    const p = property();
    const transactions = [
      tx(1, 'rent', 900, 'income'),
      tx(1, 'tenant_charges', 80, 'income'),
      tx(1, 'property_tax', 100, 'expense'),
      tx(1, 'loan_installment', 600, 'expense'), // transaction → prioritaire sur la théorique
      tx(1, 'loan_insurance', 25, 'expense'),
    ];
    const cf = computePropertyCashflow(p, transactions, 2024);
    expect(cf.totals.operating_income).toBeCloseTo(980, 0);
    expect(cf.totals.operating_expenses).toBeCloseTo(100, 0);
    // Seul le mois 1 a une transaction prêt → c'est lui qu'on vérifie.
    expect(cf.monthly[0].debt_service.total).toBeCloseTo(625, 0);
    expect(cf.monthly[0].debt_service.source).toBe('transaction');
    expect(cf.monthly[0].net_cashflow).toBeCloseTo(980 - 100 - 625, 0);
  });

  it('anti-double-comptage : la mensualité théorique est ignorée si une transaction prêt existe', () => {
    const p = property({ monthly_payment: 800, monthly_insurance: 0 }); // théorique 800, sans assurance
    const withTx = computePropertyCashflow(p, [tx(1, 'loan_installment', 600, 'expense')], 2024);
    expect(withTx.monthly[0].debt_service.total).toBeCloseTo(600, 0);
    expect(withTx.loan.used).toBe('transaction');
    expect(withTx.warnings.length).toBeGreaterThan(0);
  });

  it('sans transaction prêt → mensualité théorique (loanEngine)', () => {
    const p = property({ monthly_insurance: 0, monthly_payment: 700 });
    const cf = computePropertyCashflow(p, [tx(1, 'rent', 900, 'income')], 2024);
    expect(cf.monthly[0].debt_service.source).toBe('theoretical');
    expect(cf.monthly[0].debt_service.total).toBeGreaterThan(0);
  });

  it('virement interne inter-comptes : exclu (net = 0 sur la paire)', () => {
    const p = property();
    const transactions = [
      tx(1, 'internal_transfer', 500, 'expense'),
      tx(2, 'internal_transfer', 500, 'income'),
    ];
    const cf = computePropertyCashflow(p, transactions, 2024);
    expect(cf.totals.excluded.amount).toBeCloseTo(0, 0); // sortant - entrant = 0
  });

  it('dépôt de garantie reçu : exclu (poste de bilan)', () => {
    const cf = computePropertyCashflow(property(), [tx(1, 'deposit_received', 1000, 'income')], 2024);
    expect(cf.totals.excluded.amount).toBeCloseTo(1000, 0);
    expect(cf.totals.operating_income).toBe(0);
  });

  it('amortissement (non-décaissé) : exclu', () => {
    const cf = computePropertyCashflow(property(), [tx(1, 'amortization', 200, 'expense')], 2024);
    expect(cf.totals.excluded.amount).toBeCloseTo(-200, 0);
    expect(cf.totals.operating_expenses).toBe(0);
  });

  it('portefeuille : agrège plusieurs biens', () => {
    const p1 = property();
    const p2 = property({ id: 'prop-2', loan_amount: 0, loan_rate: 0, loan_duration_years: 0, loan_start_date: null, monthly_insurance: 0 });
    const transactions = [
      { property_id: 'prop-1', year: 2024, month: 1, category: 'rent', amount: 900, type: 'income' },
      { property_id: 'prop-2', year: 2024, month: 1, category: 'rent', amount: 700, type: 'income' },
    ];
    const port = computePortfolioCashflow([p1, p2], transactions, 2024);
    expect(port.totals.operating_income).toBeCloseTo(1600, 0);
    expect(port.monthly[0].operating_income).toBeCloseTo(1600, 0);
  });

  it('catégorie inconnue → exclue (sécurité), non dans operating', () => {
    const cf = computePropertyCashflow(property(), [tx(1, 'Bidule mystère', 300, 'income')], 2024);
    expect(cf.totals.operating_income).toBe(0);
  });
});

describe('financeEngine — service de la dette (bugs 1 & 2)', () => {
  // Propriété sans prêt théorique : aucun fallback ne vient s'ajouter.
  const noLoan = (over = {}) => ({
    id: 'prop-debt', loan_amount: 0, loan_rate: 0, loan_duration_years: 0,
    loan_start_date: null, monthly_payment: 0, monthly_insurance: 0, ...over,
  });
  const dt = (month, category, amount) => ({
    property_id: 'prop-debt', year: 2024, month, category, amount, type: 'expense',
  });
  const debt0 = (p, txs) => computePropertyCashflow(p, txs, 2024).monthly[0].debt_service;

  it('BUG 1 — assurance seule → 40 (pas 80)', () => {
    const ds = debt0(noLoan(), [dt(1, 'loan_insurance', 40)]);
    expect(ds.total).toBeCloseTo(40, 0);
    expect(ds.insurance).toBeCloseTo(40, 0);
    expect(ds.capital).toBe(0);
    expect(ds.source).toBe('transaction');
  });

  it('mensualité seule → 400 (pas 400 + assurance théorique)', () => {
    // monthly_insurance=30 présents sur le bien : ne doit JAMAIS s'ajouter.
    const ds = debt0(noLoan({ monthly_insurance: 30 }), [dt(1, 'loan_installment', 400)]);
    expect(ds.total).toBeCloseTo(400, 0);
    expect(ds.insurance).toBe(0);
    expect(ds.source).toBe('transaction');
  });

  it('mensualité + assurance → 440', () => {
    const ds = debt0(noLoan(), [dt(1, 'loan_installment', 400), dt(1, 'loan_insurance', 40)]);
    expect(ds.total).toBeCloseTo(440, 0);
    expect(ds.insurance).toBeCloseTo(40, 0);
  });

  it('BUG 2 — deux mensualités (deux prêts) → somme (pas .find)', () => {
    const ds = debt0(noLoan(), [dt(1, 'loan_installment', 400), dt(1, 'loan_installment', 350)]);
    expect(ds.total).toBeCloseTo(750, 0);
  });

  it('deux prêts (portfolio) → somme agrégée', () => {
    const p1 = noLoan({ id: 'p1' });
    const p2 = noLoan({ id: 'p2' });
    const txs = [
      { property_id: 'p1', year: 2024, month: 1, category: 'loan_installment', amount: 400, type: 'expense' },
      { property_id: 'p2', year: 2024, month: 1, category: 'loan_installment', amount: 350, type: 'expense' },
    ];
    const port = computePortfolioCashflow([p1, p2], txs, 2024);
    expect(port.monthly[0].debt_service.total).toBeCloseTo(750, 0);
    expect(port.totals.debt_service.total).toBeCloseTo(750, 0);
  });

  it('capital + intérêt (ventilation seule) → 300', () => {
    const ds = debt0(noLoan(), [dt(1, 'loan_principal', 200), dt(1, 'loan_interest', 100)]);
    expect(ds.total).toBeCloseTo(300, 0);
    expect(ds.capital).toBeCloseTo(200, 0);
    expect(ds.interest).toBeCloseTo(100, 0);
    expect(ds.source).toBe('transaction');
  });

  it('mensualité globale + ventilation → pas de double compte (400, pas 800)', () => {
    const ds = debt0(noLoan(), [
      dt(1, 'loan_installment', 400), dt(1, 'loan_principal', 300), dt(1, 'loan_interest', 100),
    ]);
    expect(ds.total).toBeCloseTo(400, 0);
    expect(ds.capital).toBeCloseTo(300, 0);
    expect(ds.interest).toBeCloseTo(100, 0);
    expect(ds.source).toBe('transaction');
  });

  it('aucune dette → 0', () => {
    const ds = debt0(noLoan(), []);
    expect(ds.total).toBe(0);
    expect(ds.source).toBe('none');
  });

  it('cohérence cash-flow : net = opérating − service de la dette (tous scénarios)', () => {
    const p = noLoan();
    const txs = [
      { property_id: 'prop-debt', year: 2024, month: 1, category: 'rent', amount: 900, type: 'income' },
      dt(1, 'loan_installment', 400), dt(1, 'loan_insurance', 40),
    ];
    const cf = computePropertyCashflow(p, txs, 2024);
    expect(cf.monthly[0].net_cashflow).toBeCloseTo(900 - 440, 0);
    expect(cf.totals.net_cashflow).toBeCloseTo(cf.totals.net_operating - cf.totals.debt_service.total, 2);
  });
});