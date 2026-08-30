import {
  buildSchedule,
  currentCRD,
  computeMonthlyPayment,
  getMonthlyPayment,
  scheduleTotals,
  scheduleAtPeriod,
  addMonthsClamped,
} from '../../shared/loanEngine.ts';

/**
 * Tests mathématiques de référence du moteur de crédit immobilier.
 * Cas connus + cas limites (taux 0, différé, assurance, mensualité manuelle,
 * remboursement anticipé, dates 28/29/30/31).
 */
function run() {
  const errors: string[] = [];
  const results: string[] = [];
  const assert = (label: string, cond: boolean, extra = '') => {
    if (cond) results.push(label);
    else errors.push(extra ? `${label} — ${extra}` : label);
  };
  const approx = (a: number, b: number, tol = 0.01) => Math.abs((a ?? 0) - (b ?? 0)) < tol;

  // T1 — Mensualité constante connue : 100 000 € à 10 % sur 12 mois → 8 791,59 €
  {
    const M = computeMonthlyPayment({ loan_amount: 100000, loan_rate: 10, loan_duration_years: 1, loan_start_date: '2024-01-01' });
    assert('T1 mensualité 100k@10%/12m ≈ 8791,59', approx(M, 8791.59), `obtenu ${M}`);
  }

  // T2 — Mensualité connue : 50 000 € à 3 % sur 15 ans → 345,29 €
  {
    const M = computeMonthlyPayment({ loan_amount: 50000, loan_rate: 3, loan_duration_years: 15, loan_start_date: '2024-01-01' });
    assert('T2 mensualité 50k@3%/15ans ≈ 345,29', approx(M, 345.29), `obtenu ${M}`);
  }

  // T3 — Taux 0 % : 100 000 € sur 10 ans → M = 833,33 €, intérêts 0
  {
    const loan = { loan_amount: 100000, loan_rate: 0, loan_duration_years: 10, loan_start_date: '2024-01-01' };
    const M = computeMonthlyPayment(loan);
    assert('T3 taux 0 : mensualité = 833,33', Math.abs(M - 833.33) < 0.01);
    const sched = buildSchedule(loan);
    const total = scheduleTotals(sched);
    assert('T3 taux 0 : intérêts = 0', total.totalInterest === 0);
    assert('T3 taux 0 : 120 échéances', sched.length === 120);
    assert('T3 taux 0 : dernière CRD = 0', Math.abs(sched[sched.length - 1].remaining) < 0.01);
  }

  // T4 — CRD connu à taux 0 : après 60 mois sur 120 → 50 000 €
  {
    const loan = { loan_amount: 100000, loan_rate: 0, loan_duration_years: 10, loan_start_date: '2024-01-01' };
    const crd = currentCRD(loan, new Date(2029, 0, 1)); // 60 mois après jan 2024
    assert('T4 CRD à 50% = 50000', Math.abs(crd - 50000) < 0.01);
  }

  // T5 — Cohérence amortissement : Σ capital = K, Σ intérêts = Σ paiements − K
  {
    const loan = { loan_amount: 100000, loan_rate: 1.55, loan_duration_years: 20, loan_start_date: '2024-01-01' };
    const sched = buildSchedule(loan);
    const t = scheduleTotals(sched);
    assert('T5 Σ principal = 100000', Math.abs(t.totalPrincipal - 100000) < 0.05);
    assert('T5 Σ intérêts + Σ principal = Σ payé hors ass.', Math.abs((t.totalInterest + t.totalPrincipal) - (t.totalPaid - t.totalInsurance)) < 0.05);
    assert('T5 dernière CRD = 0', Math.abs(sched[sched.length - 1].remaining) < 0.05);
  }

  // T6 — Dates 28/29/30/31 sans débordement setMonth
  {
    const dJan31 = addMonthsClamped('2024-01-31', 1); // 2024 bissextile
    assert('T6 31/01 + 1m = 29/02 (2024 bis.)', dJan31.getMonth() === 1 && dJan31.getDate() === 29);
    const dJan31b = addMonthsClamped('2023-01-31', 1); // 2023 non bis.
    assert('T6 31/01/2023 + 1m = 28/02', dJan31b.getMonth() === 1 && dJan31b.getDate() === 28);
    const dJan30 = addMonthsClamped('2024-01-30', 1);
    assert('T6 30/01 + 1m = 29/02', dJan30.getMonth() === 1 && dJan30.getDate() === 29);
    const dJan31m2 = addMonthsClamped('2024-01-31', 2);
    assert('T6 31/01 + 2m = 31/03 (pas de clamp)', dJan31m2.getMonth() === 2 && dJan31m2.getDate() === 31);
    const dMar31 = addMonthsClamped('2023-03-31', 1); // avril = 30j
    assert('T6 31/03/2023 + 1m = 30/04', dMar31.getMonth() === 3 && dMar31.getDate() === 30);
    const dOct31 = addMonthsClamped('2024-10-31', 1);
    assert('T6 31/10 + 1m = 30/11', dOct31.getMonth() === 10 && dOct31.getDate() === 30);
  }

  // T7 — Échéancier démarré le 31 : 31/05 + 1m = 31/06 impossible → 30/06
  {
    const loan = { loan_amount: 12000, loan_rate: 0, loan_duration_years: 1, loan_start_date: '2024-05-31' };
    const sched = buildSchedule(loan);
    assert('T7 31/05 → échéance 2 = 30/06', sched[1].date.getMonth() === 5 && sched[1].date.getDate() === 30);
    assert('T7 12 échéances, CRD final 0', sched.length === 12 && Math.abs(sched[11].remaining) < 0.01);
  }

  // T8 — Différé d'amortissement 6 mois : intérêts seuls puis amortissement
  {
    const loan = { loan_amount: 100000, loan_rate: 1.2, loan_duration_years: 10, loan_start_date: '2024-01-01', loan_deferred_months: 6 };
    const sched = buildSchedule(loan);
    assert('T8 différé : 6 premières échéances intérêts seuls', sched.slice(0, 6).every((r) => r.isDeferred && r.principal === 0));
    assert('T8 différé : CRD constant pendant le différé', Math.abs(sched[5].remaining - 100000) < 0.01);
    assert('T8 différé : amortissement commence en échéance 7', !sched[6].isDeferred && sched[6].principal > 0);
    assert('T8 différé : CRD final = 0', Math.abs(sched[sched.length - 1].remaining) < 0.05);
    // intértsåpendant différé = 100000 * 0.001 = 100 € / mois
    assert('T8 intérêts différé = 100€/mois', Math.abs(sched[0].interest - 100) < 0.01);
  }

  // T9 — Assurance : ajoutée à chaque échéance, neutre sur le CRD
  {
    const loan = { loan_amount: 60000, loan_rate: 0, loan_duration_years: 5, loan_start_date: '2024-01-01', monthly_insurance: 30 };
    const sched = buildSchedule(loan);
    assert('T9 Assurance = 30 sur chaque échéance', sched.every((r) => Math.abs(r.insurance - 30) < 0.001));
    assert('T9 CRD final = 0 (assurance neutre)', Math.abs(sched[sched.length - 1].remaining) < 0.01);
    const t = scheduleTotals(sched);
    assert('T9 Σ assurance = 30 × 60 = 1800', Math.abs(t.totalInsurance - 1800) < 0.01);
  }

  // T10 — Mensualité saisie manuellement supérieure → durée raccourcie
  {
    const loan = { loan_amount: 100000, loan_rate: 1.55, loan_duration_years: 20, loan_start_date: '2024-01-01', monthly_payment: 600 };
    const sched = buildSchedule(loan);
    assert('T10 mensualité manuelle 600 → durée < 240 mois', sched.length < 240);
    assert('T10 CRD final = 0', Math.abs(sched[sched.length - 1].remaining) < 0.05);
    // La mensualité utilisée = 600 (hors assurance)
    assert('T10 échéance hors ass. = 600 (hors dernière)', Math.abs(sched[0].principal + sched[0].interest - 600) < 0.01);
  }

  // T11 — Mensualité manuelle prise en compte via getMonthlyPayment
  {
    const loan = { loan_amount: 100000, loan_rate: 1.55, loan_duration_years: 20, loan_start_date: '2024-01-01', monthly_payment: 500 };
    assert('T11 getMonthlyPayment = saisie', Math.abs(getMonthlyPayment(loan) - 500) < 0.001);
    const loanNoM = { loan_amount: 100000, loan_rate: 1.55, loan_duration_years: 20, loan_start_date: '2024-01-01' };
    const Mform = computeMonthlyPayment(loanNoM);
    assert('T11 getMonthlyPayment = formule si non saisie', Math.abs(getMonthlyPayment(loanNoM) - Mform) < 0.001);
  }

  // T12 — Remboursement anticipé 20 000 € au mois 12 (taux 0) : durée raccourcie
  {
    const loan = {
      loan_amount: 100000, loan_rate: 0, loan_duration_years: 10, loan_start_date: '2024-01-01',
      early_repayments: [{ month: 12, amount: 20000 }],
    };
    const sched = buildSchedule(loan);
    // Avant RA : M = 833,33 ; après 12 mois, capital remboursé = 10 000, RA 20 000 → CRD = 70 000
    assert('T12 CRD après échéance 12 = 70000', Math.abs(sched[11].remaining - 70000) < 0.01);
    assert('T12 RA reporté sur l\'échéance 12', Math.abs(sched[11].earlyRepayment - 20000) < 0.001);
    // Reste 70 000 à 833,33/mois → 84 mois supplémentaires → 96 échéances totales
    assert('T12 durée ramenée à 96 mois', sched.length === 96);
    assert('T12 CRD final = 0', Math.abs(sched[95].remaining) < 0.01);
  }

  // T13 — scheduleAtPeriod pour le moteur de cash-flow
  {
    const loan = { loan_amount: 100000, loan_rate: 1.55, loan_duration_years: 20, loan_start_date: '2024-01-01' };
    const pt = scheduleAtPeriod(loan, 2024, 1);
    assert('T13 scheduleAtPeriod(2024,1) non null', pt !== null);
    const ptFuture = scheduleAtPeriod(loan, 2050, 1);
    assert('T13 scheduleAtPeriod hors plage = null', ptFuture === null);
  }

  // T14 — Sans données de prêt : tout est nul
  {
    assert('T14 buildSchedule vide sans prêt', buildSchedule({}).length === 0);
    assert('T14 currentCRD vide sans prêt', currentCRD({}) === 0);
    assert('T14 computeMonthlyPayment vide sans prêt', computeMonthlyPayment({}) === 0);
  }

  // T15 — Intérêts décroissants (amortissement constant) : i1 > i2 et principal croissant
  {
    const loan = { loan_amount: 100000, loan_rate: 3, loan_duration_years: 10, loan_start_date: '2024-01-01' };
    const sched = buildSchedule(loan);
    assert('T15 intérêts décroissants', sched[0].interest > sched[1].interest && sched[1].interest > sched[2].interest);
    assert('T15 principal croissant', sched[0].principal < sched[1].principal && sched[1].principal < sched[2].principal);
  }

  return { ok: errors.length === 0, total: results.length, errors, results };
}

export default async function (_req: Request): Promise<Response> {
  try {
    const r = run();
    return Response.json(r);
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

void [buildSchedule, currentCRD, computeMonthlyPayment, getMonthlyPayment, scheduleTotals, scheduleAtPeriod, addMonthsClamped];