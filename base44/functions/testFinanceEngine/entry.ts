import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  computePropertyCashflow,
  computePortfolioCashflow,
  cashflowBucketOf,
} from '../../shared/financeEngine.ts';
import { resolveKey } from '../../shared/financeCategories.ts';

/**
 * Tests de cohérence du MOTEUR FINANCIER UNIQUE :
 *  - buckets canoniques (OPERATING_INCOME / OPERATING_EXPENSES / DEBT_SERVICE / EXCLUDED)
 *  - formule NET_CASHFLOW = NET_OPERATING − DEBT_SERVICE
 *  - anti-double-comptage : une transaction « Échéance prêt » ne s'additionne
 *    pas à la mensualité théorique du bien.
 *  - isolation capital / intérêts / assurance.
 *  - traitement des flux exclus (dépôt, virement interne, provisions, travaux).
 *  - cohérence(portefeuille == Σ biens).
 */

const eq = (a, b, label) =>
  Math.abs((a ?? 0) - (b ?? 0)) < 0.01
    ? { pass: true, msg: label }
    : { pass: false, msg: `${label} : attendu ${b}, obtenu ${a}` };

function run() {
  const errors: any[] = [];
  const asserts: any[] = [];
  const assert = (label, cond) => {
    asserts.push({ label, pass: !!cond });
    if (!cond) errors.push(label);
  };

  const prop = (over = {}) => ({
    id: 'P1',
    name: 'Bien test',
    tax_regime: 'Location nue (revenus fonciers)',
    monthly_payment: 700,          // théorique (hors assurance)
    monthly_insurance: 30,         // théorique
    loan_amount: 100000,
    loan_rate: 2,
    loan_duration_years: 20,
    loan_start_date: '2024-01-01',
    ...over,
  });

  // ── T1 : buckets canoniques ──
  {
    assert('rent → operating_income', cashflowBucketOf('rent') === 'operating_income');
    assert('caf → operating_income', cashflowBucketOf('caf') === 'operating_income');
    assert('tenant_charges → operating_income', cashflowBucketOf('tenant_charges') === 'operating_income');
    assert('property_insurance → operating_expense', cashflowBucketOf('property_insurance') === 'operating_expense');
    assert('works → operating_expense', cashflowBucketOf('works') === 'operating_expense');
    assert('loan_installment → debt_service', cashflowBucketOf('loan_installment') === 'debt_service');
    assert('loan_insurance → debt_service', cashflowBucketOf('loan_insurance') === 'debt_service');
    assert('deposit_received → excluded', cashflowBucketOf('deposit_received') === 'excluded');
    assert('internal_transfer → excluded', cashflowBucketOf('internal_transfer') === 'excluded');
    assert('provisions → excluded', cashflowBucketOf('provisions') === 'excluded');
    assert('amortization → excluded', cashflowBucketOf('amortization') === 'excluded');
    assert('vat → excluded', cashflowBucketOf('vat') === 'excluded');
    assert('legacy « Échéance prêt » → debt_service', cashflowBucketOf('Échéance prêt') === 'debt_service');
    assert('legacy « Loyer » → operating_income', cashflowBucketOf('Loyer') === 'operating_income');
  }

  // ── T2 : cas général — loyer + charges + CAF, charges d'exploitation, prêt en transaction ──
  //   Mensualité théorique 700€ + 30€ ass. ; transaction échéance prêt 750€ sur 12 mois.
  //   Le crédit doit être compté UNE SEULE FOIS via la transaction (750€), pas 700+750.
  {
    const p = prop();
    const txs: any[] = [];
    for (let m = 1; m <= 12; m++) {
      txs.push({ property_id: 'P1', type: 'income', category: 'rent', amount: 800, year: 2026, month: m });
      txs.push({ property_id: 'P1', type: 'income', category: 'tenant_charges', amount: 50, year: 2026, month: m });
      txs.push({ property_id: 'P1', type: 'income', category: 'caf', amount: 200, year: 2026, month: m });
      txs.push({ property_id: 'P1', type: 'expense', category: 'property_insurance', amount: -20, year: 2026, month: m });
      txs.push({ property_id: 'P1', type: 'expense', category: 'condo_fees', amount: -60, year: 2026, month: m });
      txs.push({ property_id: 'P1', type: 'expense', category: 'loan_installment', amount: -750, year: 2026, month: m });
    }
    const cf = computePropertyCashflow(p, txs, 2026);
    const t = cf.totals;

    // Operating income annuel = (800+50+200)*12 = 12600
    asserts.push(eq(t.operating_income, 12600, 'T2 operating_income'));
    // Operating expenses annuel = (20+60)*12 = 960 (prêt EXCLU des charges d'exploitation)
    asserts.push(eq(t.operating_expenses, 960, 'T2 operating_expenses (hors prêt)'));
    asserts.push(eq(t.net_operating, 11640, 'T2 net_operating'));
    // Debt service = installment (750*12=9000, transaction) + insurance théorique (30*12=360) = 9360
    asserts.push(eq(t.debt_service.total, 9360, 'T2 debt_service total (installment tx + assurance théorique)'));
    // Anti-double-comptage : la part "échéance" vient de la transaction (9000), pas de la mensualité théorique (8400).
    assert('T2 pas de double comptage du crédit (installment = 9000 ≠ 8400 théorique)',
      Math.abs((t.debt_service.total - t.debt_service.insurance) - 9000) < 0.01);
    assert('T2 mensualité théorique (700*12=8400) NON sommée à la transaction',
      Math.abs((t.debt_service.total - t.debt_service.insurance) - 8400) > 0.01);
    // Net cashflow = 11640 - 9360 = 2280
    asserts.push(eq(t.net_cashflow, 2280, 'T2 net_cashflow'));
    // Formule canonique
    assert('T2 formule NET = OP_INC − OP_EXP − DEBT',
      Math.abs(t.net_cashflow - (t.operating_income - t.operating_expenses - t.debt_service.total)) < 0.01);
    // Warning double-comptage présent
    assert('T2 warning double-comptage', cf.warnings.length > 0);
    assert('T2 loan.used = transaction', cf.loan.used === 'transaction');
    // Découpe capital/intérêts > 0
    assert('T2 capital > 0', t.debt_service.capital > 0);
    assert('T2 interest > 0', t.debt_service.interest > 0);
    assert('T2 capital+interest = installment hors assurance',
      Math.abs((t.debt_service.capital + t.debt_service.interest) - 9000) < 0.01);
    // Assurance = 30*12 = 360 (théorique, aucune tx loan_insurance)
    asserts.push(eq(t.debt_service.insurance, 360, 'T2 insurance théorique'));
  }

  // ── T3 : AUCUNE transaction prêt → fallback mensualité théorique (700+30) ──
  {
    const p = prop();
    const txs: any[] = [];
    for (let m = 1; m <= 12; m++) {
      txs.push({ property_id: 'P1', type: 'income', category: 'rent', amount: 800, year: 2026, month: m });
      txs.push({ property_id: 'P1', type: 'expense', category: 'property_insurance', amount: -20, year: 2026, month: m });
    }
    const cf = computePropertyCashflow(p, txs, 2026);
    const t = cf.totals;
    // Debt service = (700+30)*12 = 8760 (théorique)
    asserts.push(eq(t.debt_service.total, 8760, 'T3 debt_service théorique (fallback)'));
    assert('T3 loan.used = theoretical', cf.loan.used === 'theoretical');
    // Operating expenses = 20*12 = 240 (prêt en debt_service, pas en opex)
    asserts.push(eq(t.operating_expenses, 240, 'T3 opex sans prêt'));
    asserts.push(eq(t.net_cashflow, 800 * 12 - 240 - 8760, 'T3 net_cashflow'));
  }

  // ── T4 : flux EXCLUDED (dépôt, virement interne, provisions, amortissement) ──
  {
    const p = prop({ monthly_payment: 0, monthly_insurance: 0, loan_amount: 0, loan_start_date: null });
    const txs: any[] = [
      { property_id: 'P1', type: 'income', category: 'rent', amount: 800, year: 2026, month: 1 },
      { property_id: 'P1', type: 'income', category: 'deposit_received', amount: 1000, year: 2026, month: 1 },
      { property_id: 'P1', type: 'expense', category: 'internal_transfer', amount: -500, year: 2026, month: 1 },
      { property_id: 'P1', type: 'expense', category: 'provisions', amount: -200, year: 2026, month: 1 },
      { property_id: 'P1', type: 'expense', category: 'amortization', amount: -300, year: 2026, month: 1 },
    ];
    const cf = computePropertyCashflow(p, txs, 2026);
    const t = cf.totals;
    // Operating income = 800 (dépôt EXCLU)
    asserts.push(eq(t.operating_income, 800, 'T4 op income (dépôt exclu)'));
    // Operating expenses = 0 (virement/provisions/amortissement exclus)
    asserts.push(eq(t.operating_expenses, 0, 'T4 opex (flux exclus)'));
    // Net operating = 800
    asserts.push(eq(t.net_operating, 800, 'T4 net_operating'));
    // Debt service = 0
    asserts.push(eq(t.debt_service.total, 0, 'T4 debt_service nul'));
    // Net cashflow = 800 (les flux exclus n'affectent pas le cash-flow d'exploitation)
    asserts.push(eq(t.net_cashflow, 800, 'T4 net_cashflow = net_operating (exclus non comptés)'));
    // Excluded net = +1000 - 500 - 200 - 300 = 0
    asserts.push(eq(t.excluded.amount, 0, 'T4 excluded net = 0'));
    assert('T4 deposit_received dans excluded breakdown', (t.excluded.breakdown['deposit_received'] || 0) === 1000);
    assert('T4 internal_transfer dans excluded breakdown', (t.excluded.breakdown['internal_transfer'] || 0) === -500);
  }

  // ── T5 : travaux = charge d'exploitation (décaissée) ──
  {
    const p = prop({ monthly_payment: 0, monthly_insurance: 0, loan_amount: 0, loan_start_date: null });
    const txs = [
      { property_id: 'P1', type: 'income', category: 'rent', amount: 800, year: 2026, month: 3 },
      { property_id: 'P1', type: 'expense', category: 'works', amount: -5000, year: 2026, month: 3 },
    ];
    const cf = computePropertyCashflow(p, txs, 2026);
    const t = cf.totals;
    asserts.push(eq(t.operating_expenses, 5000, 'T5 travaux en opex'));
    asserts.push(eq(t.net_cashflow, 800 - 5000, 'T5 net_cashflow avec travaux'));
  }

  // ── T6 : cohérence portefeuille == somme des biens ──
  {
    const p1 = prop({ id: 'P1' });
    const p2 = prop({ id: 'P2', name: 'Bien 2' });
    const txs: any[] = [];
    for (let m = 1; m <= 12; m++) {
      txs.push({ property_id: 'P1', type: 'income', category: 'rent', amount: 800, year: 2026, month: m });
      txs.push({ property_id: 'P1', type: 'expense', category: 'loan_installment', amount: -750, year: 2026, month: m });
      txs.push({ property_id: 'P2', type: 'income', category: 'rent', amount: 1000, year: 2026, month: m });
      txs.push({ property_id: 'P2', type: 'expense', category: 'condo_fees', amount: -80, year: 2026, month: m });
    }
    const cf1 = computePropertyCashflow(p1, txs, 2026).totals;
    const cf2 = computePropertyCashflow(p2, txs, 2026).totals;
    const portfolio = computePortfolioCashflow([p1, p2], txs, 2026).totals;
    asserts.push(eq(portfolio.operating_income, cf1.operating_income + cf2.operating_income, 'T6 portfolio op_income = Σ'));
    asserts.push(eq(portfolio.operating_expenses, cf1.operating_expenses + cf2.operating_expenses, 'T6 portfolio opex = Σ'));
    asserts.push(eq(portfolio.debt_service.total, cf1.debt_service.total + cf2.debt_service.total, 'T6 portfolio debt = Σ'));
    asserts.push(eq(portfolio.net_cashflow, cf1.net_cashflow + cf2.net_cashflow, 'T6 portfolio net = Σ biens'));
    assert('T6 cohérence formule portefeuille',
      Math.abs(portfolio.net_cashflow - (portfolio.operating_income - portfolio.operating_expenses - portfolio.debt_service.total)) < 0.01);
  }

  return {
    ok: errors.length === 0,
    errorCount: errors.length,
    errors,
    asserts,
  };
}

export default async function (_req: Request): Promise<Response> {
  try {
    const r = run();
    return Response.json(r);
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// silence unused import warnings
void [resolveKey, createClientFromRequest];