import { describe, it, expect } from 'vitest';
import {
  computeMonthlyPayment,
  getMonthlyPayment,
  buildSchedule,
  currentCRD,
  scheduleAtPeriod,
  scheduleTotals,
  addMonthsClamped,
} from '../../base44/shared/loanEngine.ts';

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

describe('loanEngine — crédit immobilier', () => {
  it('mensualité 100k@10%/12m ≈ 8 791,59 €', () => {
    const M = computeMonthlyPayment({ loan_amount: 100000, loan_rate: 10, loan_duration_years: 1, loan_start_date: '2024-01-05' });
    expect(M).toBeCloseTo(8791.59, 1);
  });

  it('mensualité 50k@3%/15ans ≈ 345,29 €', () => {
    const M = computeMonthlyPayment({ loan_amount: 50000, loan_rate: 3, loan_duration_years: 15, loan_start_date: '2024-01-05' });
    expect(M).toBeCloseTo(345.29, 1);
  });

  it('taux 0 % : mensualité = K / n, intérêts = 0, CRD final = 0', () => {
    const loan = { loan_amount: 10000, loan_rate: 0, loan_duration_years: 10, loan_start_date: '2024-01-05' };
    expect(computeMonthlyPayment(loan)).toBeCloseTo(83.33, 2);
    const sched = buildSchedule(loan);
    expect(sched.length).toBe(120);
    expect(scheduleTotals(sched).totalInterest).toBe(0);
    expect(sched[sched.length - 1].remaining).toBe(0);
  });

  it("sans données de prêt → échéancier vide et CRD = 0", () => {
    expect(buildSchedule({})).toEqual([]);
    expect(computeMonthlyPayment({})).toBe(0);
    expect(currentCRD({})).toBe(0);
  });

  it('Σ capital amorti = K et CRD final = 0 (prêt normal)', () => {
    const sched = buildSchedule({ loan_amount: 100000, loan_rate: 3, loan_duration_years: 20, loan_start_date: '2024-01-05' });
    const t = scheduleTotals(sched);
    expect(round2(t.totalPrincipal)).toBeCloseTo(100000, 0); // tolérance arrondi sur 180 échéances
    expect(sched[sched.length - 1].remaining).toBe(0);
  });

  it('cohérence : Σ intérêts + Σ capital = Σ payé hors assurance', () => {
    const sched = buildSchedule({ loan_amount: 120000, loan_rate: 2.5, loan_duration_years: 18, loan_start_date: '2024-05-10', monthly_insurance: 25 });
    const t = scheduleTotals(sched);
    expect(round2(t.totalInterest + t.totalPrincipal)).toBeCloseTo(round2(t.totalPaid - t.totalInsurance), 1);
  });

  it('CRD à 50 % du prêt ≈ K/2 (taux faible)', () => {
    const loan = { loan_amount: 180000, loan_rate: 1.5, loan_duration_years: 15, loan_start_date: '2024-01-05' };
    const sched = buildSchedule(loan);
    const mid = sched[Math.floor(sched.length / 2)];
    // Amortissement non linéaire (intérêts en début) → CRD à mi-parcours > K/2.
    expect(mid.remaining).toBeGreaterThan(85000);
    expect(mid.remaining).toBeLessThan(100000);
  });

  it('différé d’amortissement : intérêts seuls pendant N mois, CRD constant', () => {
    const loan = { loan_amount: 120000, loan_rate: 3, loan_duration_years: 10, loan_start_date: '2024-01-05', loan_deferred_months: 6 };
    const sched = buildSchedule(loan);
    for (let i = 0; i < 6; i++) {
      expect(sched[i].isDeferred).toBe(true);
      expect(sched[i].principal).toBe(0);
    }
    expect(sched[0].beginCapital).toBe(sched[5].beginCapital);
    expect(sched[6].isDeferred).toBe(false);
    expect(sched[6].principal).toBeGreaterThan(0);
    expect(sched[sched.length - 1].remaining).toBe(0);
  });

  it("assurance neutre sur le CRD et ajoutée à chaque échéance", () => {
    const loan = { loan_amount: 60000, loan_rate: 2, loan_duration_years: 5, loan_start_date: '2024-01-05', monthly_insurance: 30 };
    const sched = buildSchedule(loan);
    expect(sched.every((r) => r.insurance === 30)).toBe(true);
    expect(sched[sched.length - 1].remaining).toBe(0);
    expect(scheduleTotals(sched).totalInsurance).toBeCloseTo(30 * sched.length, 0);
  });

  it('mensualité saisie manuellement → prioritaire sur la formule et raccourcit la durée', () => {
    const loan = { loan_amount: 120000, loan_rate: 2.5, loan_duration_years: 20, loan_start_date: '2024-01-05', monthly_payment: 700 };
    expect(getMonthlyPayment(loan)).toBe(700);
    const sched = buildSchedule(loan);
    expect(sched.length).toBeLessThan(240);
    expect(sched[sched.length - 1].remaining).toBe(0);
  });

  it('remboursement anticipé réduit le CRD et raccourcit la durée', () => {
    const loan = {
      loan_amount: 100000, loan_rate: 3, loan_duration_years: 10, loan_start_date: '2024-01-05',
      early_repayments: [{ month: 12, amount: 20000 }],
    };
    const sched = buildSchedule(loan);
    expect(sched[11].earlyRepayment).toBe(20000);
    expect(sched[11].remaining).toBeGreaterThan(70000);
    expect(sched[11].remaining).toBeLessThan(75000);
    expect(sched.length).toBeLessThan(120);
    expect(sched[sched.length - 1].remaining).toBe(0);
  });

  it('scheduleAtPeriod : null hors plage, non null dans la plage', () => {
    const loan = { loan_amount: 50000, loan_rate: 2, loan_duration_years: 5, loan_start_date: '2024-01-05' };
    expect(scheduleAtPeriod(loan, 2024, 1)).not.toBeNull();
    expect(scheduleAtPeriod(loan, 2030, 1)).toBeNull();
    expect(scheduleAtPeriod(loan, 2024, 1).installment).toBeGreaterThan(0);
  });

  it('currentCRD : avant la 1ʳᵉ échéance = K, après la dernière = 0', () => {
    const loan = { loan_amount: 100000, loan_rate: 3, loan_duration_years: 10, loan_start_date: '2024-01-05' };
    const start = new Date('2024-01-05');
    expect(currentCRD(loan, start)).toBe(100000);
    expect(currentCRD(loan, new Date('2035-01-01'))).toBe(0);
  });
});