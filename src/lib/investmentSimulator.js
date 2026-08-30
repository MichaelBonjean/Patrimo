/**
 * Moteur de calcul du simulateur d'investissement (projet pré-acquisition).
 * Déterministe, sans date, sans ledger — distinct du financeEngine (cash-flow réel).
 *
 * Calcule : coût total, mensualité (amorçable avec différé), rendement brut/net,
 * cash-flow, cash-on-cash, DSCR, LTV.
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);

export function simulateScenario(s) {
  const a = s?.achat || {};
  const f = s?.financement || {};
  const e = s?.exploitation || {};

  const price = num(a.price);
  const notary = num(a.notary);
  const agency = num(a.agency);
  const works = num(a.works);
  const furniture = num(a.furniture);

  const downPayment = num(f.down_payment);
  const loanAmount = num(f.loan_amount);
  const rate = num(f.rate); // % annuel
  const durationYears = num(f.duration_years);
  const insuranceMonthly = num(f.insurance); // €/mois
  const deferredMonths = num(f.deferred_months);

  const rentMonthly = num(e.rent_monthly);
  const chargesMonthly = num(e.charges_monthly);
  const propertyTax = num(e.property_tax);
  const vacancyRate = num(e.vacancy_rate); // %
  const managementFeeRate = num(e.management_fee_rate); // %
  const insurancePno = num(e.insurance_pno);
  const maintenance = num(e.maintenance);

  const totalCost = round2(price + notary + agency + works + furniture);

  // Mensualité d'amortissement (hors assurance). différé = intérêts seuls hors amortissement.
  const monthlyRate = rate / 100 / 12;
  const amortizingMonths = Math.max(1, Math.round(durationYears * 12) - deferredMonths);
  let monthlyPayment = 0;
  if (loanAmount > 0 && durationYears > 0) {
    monthlyPayment = monthlyRate === 0
      ? loanAmount / amortizingMonths
      : (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, amortizingMonths)) /
        (Math.pow(1 + monthlyRate, amortizingMonths) - 1);
  }
  monthlyPayment = round2(monthlyPayment);
  const monthlyTotal = round2(monthlyPayment + insuranceMonthly);
  const annualDebtService = round2(monthlyTotal * 12);

  const annualRentGross = round2(rentMonthly * 12);
  const annualRentNetVacancy = round2(annualRentGross * (1 - vacancyRate / 100));
  const managementFees = round2(annualRentGross * (1 - vacancyRate / 100) * (managementFeeRate / 100));
  const annualCharges = round2(propertyTax + insurancePno + maintenance + chargesMonthly * 12 + managementFees);
  const noi = round2(annualRentNetVacancy - annualCharges);
  const cashFlowAnnual = round2(noi - annualDebtService);
  const cashFlowMonthly = round2(cashFlowAnnual / 12);

  const grossYield = totalCost > 0 ? round2((annualRentGross / totalCost) * 100) : 0;
  const netYield = totalCost > 0 ? round2((noi / totalCost) * 100) : 0;
  const cashInvested = round2(Math.max(0, totalCost - loanAmount));
  const cashOnCash = cashInvested > 0 ? round2((cashFlowAnnual / cashInvested) * 100) : 0;
  const dscr = annualDebtService > 0 ? round2(noi / annualDebtService) : 0;
  const ltv = totalCost > 0 ? round2((loanAmount / totalCost) * 100) : 0;

  return {
    totalCost, cashInvested,
    monthlyPayment, monthlyInsurance: insuranceMonthly, monthlyTotal, annualDebtService,
    annualRentGross, annualRentNetVacancy, annualCharges, noi,
    cashFlowMonthly, cashFlowAnnual,
    grossYield, netYield, cashOnCash, dscr, ltv,
  };
}

export const EMPTY_SCENARIO = {
  name: 'Nouveau scénario',
  achat: { price: null, notary: null, agency: null, works: null, furniture: 0 },
  financement: { down_payment: null, loan_amount: null, rate: null, duration_years: 20, insurance: 0, deferred_months: 0 },
  exploitation: { rent_monthly: null, charges_monthly: 0, property_tax: null, vacancy_rate: 0, management_fee_rate: 7, insurance_pno: 0, maintenance: 0 },
};