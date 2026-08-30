/**
 * MOTEUR CASH-FLOW RÉEL vs THÉORIQUE — distingue le prévisionnel de l'observé.
 *
 * Source de vérité :
 *   THÉORIQUE  = Lease (loyer + charges attendus) + Loan théorique (loanEngine).
 *                Aucune transaction nécessaire — c'est la prévision.
 *   RÉEL       = Transactions bancaires validées (Payments encaissés + dépenses
 *                validées + service de la dette réellement débité). AUCUN fallback
 *                théorique sur la dette : si rien n'est débité, la dette réelle = 0.
 *
 * Performance (Rentabilité brute / nette / nette-nette) : on réutilise les
 * MÊMES formules que le cockpit (revenus/prix de revient, cash-flow/prix de
 * revient, cash-flow/capital investi) — jamais une formule « Banque » dédiée.
 *
 * Complétude : si la période réelle ne couvre qu'une partie des mois (ex. 2 mois
 * de banque sur l'année), les indicateurs annualisés sont explicitement basés
 * sur une période partielle (flag `partial` + annualisation sur `coverageMonths`).
 *
 * Périodes supportées : mois, YTD, 12 derniers mois, année.
 */
import { resolveKey, cashflowBucketOf } from './financeCategories.ts';
import { scheduleAtPeriod } from './loanEngine.ts';

export type PeriodKind = 'month' | 'ytd' | 't12m' | 'year';

export interface PeriodInput {
  kind: PeriodKind;
  year: number;
  month?: number;
  /** ISO YYYY-MM-DD. Sert pour 'ytd' (mois de clôture) et 't12m' (mois final). */
  asOf?: string;
}

export type VarianceKind =
  | 'missing_rent' | 'extra_rent'
  | 'other_income'
  | 'higher_charges' | 'exceptional_expense'
  | 'debt_diff' | 'other';

export interface VarianceItem {
  kind: VarianceKind;
  label: string;
  amount: number; // effet sur le cash-flow net (négatif = appauvrit le réel vs prévision)
}

export interface CompareResult {
  period: { kind: PeriodKind; label: string; monthsCount: number; coverageMonths: number; complete: boolean; partial: boolean };
  theoretical: { rent_income: number; other_income: number; planned_charges: number; debt_service: number; net: number };
  real: {
    rent_income: number; other_income: number;
    operating_expenses: number; recurring_expenses: number; exceptional_expenses: number;
    debt_service: number; net: number;
  };
  variance: { total: number; items: VarianceItem[] };
  performance: {
    real: { grossYield: number; netYield: number; netNetYield: number; annualized: boolean; basisMonths: number };
    theoretical: { grossYield: number; netYield: number; netNetYield: number };
  };
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const abs = (n: number) => Math.abs(Number(n) || 0);

const RECURRING_EXPENSE = new Set([
  'property_insurance', 'unpaid_rent_insurance', 'property_tax', 'cfe',
  'condo_fees', 'management_fees', 'accounting_fees', 'bank_fees', 'sci_fees',
  'maintenance', 'electricity', 'water', 'gas', 'internet', 'waste',
]);
const EXCEPTIONAL_EXPENSE = new Set([
  'works', 'notary_fees', 'legal_fees', 'agency_fees', 'supplies', 'other_expense',
]);

const MONTH_LABELS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

function defaultAsOf(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Liste des mois (year, month) couverts par la période. */
export function monthsForPeriod(period: PeriodInput): Array<{ year: number; month: number }> {
  const asOf = period.asOf || defaultAsOf();
  const [ay, am] = asOf.split('-').map(Number);
  if (period.kind === 'month') {
    return [{ year: period.year, month: Number(period.month) }];
  }
  if (period.kind === 'year') {
    return Array.from({ length: 12 }, (_, i) => ({ year: period.year, month: i + 1 }));
  }
  if (period.kind === 'ytd') {
    const out: Array<{ year: number; month: number }> = [];
    for (let m = 1; m <= am; m++) out.push({ year: ay, month: m });
    return out;
  }
  // t12m : 12 mois glissants terminant au mois de asOf (inclus).
  const out: Array<{ year: number; month: number }> = [];
  let y = ay, m = am;
  for (let i = 0; i < 12; i++) {
    out.unshift({ year: y, month: m });
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
  }
  return out;
}

export function periodLabel(period: PeriodInput): string {
  const ms = monthsForPeriod(period);
  if (period.kind === 'month') return `${MONTH_LABELS[ms[0].month - 1]} ${ms[0].year}`;
  if (period.kind === 'year') return `Année ${period.year}`;
  if (period.kind === 'ytd') return `YTD ${MONTH_LABELS[ms[ms.length - 1].month - 1]} ${ms[0].year}`;
  return `12 mois · ${MONTH_LABELS[ms[0].month - 1]} ${ms[0].year} → ${MONTH_LABELS[ms[ms.length - 1].month - 1]} ${ms[ms.length - 1].year}`;
}

/** Lease couvre-t-il un mois donné ? */
function leaseCoversMonth(lease: any, year: number, month: number): boolean {
  if (!lease.date_start) return false;
  const lastDay = new Date(year, month, 0).getDate();
  const firstISO = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastISO = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  if (lease.date_start > lastISO) return false;
  if (lease.date_end && lease.date_end < firstISO) return false;
  return true;
}

function acquisitionCost(p: any): number {
  return abs(p.purchase_price) + abs(p.notary_fees) + abs(p.agency_fees) + abs(p.initial_works);
}
function investedCapital(p: any): number {
  const acq = acquisitionCost(p);
  if (Number(p.down_payment) > 0) return Number(p.down_payment);
  return Math.max(0, acq - abs(p.loan_amount));
}

interface MonthAgg {
  expected_rent: number;
  th_debt: number;
  real_rent: number;
  real_other_income: number;
  real_recurring: number;
  real_exceptional: number;
  real_debt: number;
  hasRealTx: boolean;
}

function aggregateMonth(properties: any[], leases: any[], transactions: any[], y: number, m: number): MonthAgg {
  const agg: MonthAgg = {
    expected_rent: 0, th_debt: 0,
    real_rent: 0, real_other_income: 0, real_recurring: 0, real_exceptional: 0, real_debt: 0,
    hasRealTx: false,
  };
  for (const p of properties) {
    // Théorique : loyer attendu (bail couvrant le mois).
    for (const l of leases || []) {
      if (l.property_id !== p.id) continue;
      if (!leaseCoversMonth(l, y, m)) continue;
      agg.expected_rent += abs(l.rent_excluding_charges) + abs(l.charges);
    }
    // Théorique : service de la dette théorique (loanEngine).
    const sched = scheduleAtPeriod(p, y, m);
    const thInst = sched ? sched.installment : (Number(p.monthly_payment) > 0 ? Number(p.monthly_payment) : 0);
    const thIns = Number(p.monthly_insurance) || 0;
    agg.th_debt += thInst + thIns;

    // Réel : transactions bancaires validées du mois.
    const monthTx = (transactions || []).filter(
      (t) => t.property_id === p.id && Number(t.year) === y && Number(t.month) === m
    );
    if (monthTx.length > 0) agg.hasRealTx = true;
    for (const t of monthTx) {
      const key = resolveKey(t.category);
      const bucket = cashflowBucketOf(key);
      const a = abs(t.amount);
      if (bucket === 'operating_income') {
        if (key === 'rent') agg.real_rent += a;
        else agg.real_other_income += a;
      } else if (bucket === 'operating_expense') {
        if (RECURRING_EXPENSE.has(key)) agg.real_recurring += a;
        else if (EXCEPTIONAL_EXPENSE.has(key)) agg.real_exceptional += a;
        // (other → excluded, ignoré)
      } else if (bucket === 'debt_service') {
        // géré ci-dessous (anti-double-comptage) — on n'accumule pas ici
      }
    }
  }
  // Anti-double-comptage de la dette réelle (même convention que financeEngine) :
  // capital+intérêts = loan_installment si présent, sinon principal+interest ;
  // assurance = loan_insurance, distincte.
  // (Recalculé par mois à partir des transactions du mois — agrégé au-dessus
  //  via une somme brute qu'on corrige ici pour ne pas compter 2×.)
  // NOTE: agg.real_debt a sommé TOUTES les tx debt_service ; on recalcule proprement.
  let realDebt = 0;
  for (const p of properties) {
    const monthTx = (transactions || []).filter(
      (t) => t.property_id === p.id && Number(t.year) === y && Number(t.month) === m
    );
    const debtTx = monthTx.filter((t) => cashflowBucketOf(resolveKey(t.category)) === 'debt_service');
    const sumBy = (k: string) => debtTx.filter((t) => resolveKey(t.category) === k).reduce((s, t) => s + abs(t.amount), 0);
    const inst = sumBy('loan_installment');
    const prin = sumBy('loan_principal');
    const inte = sumBy('loan_interest');
    const ins = sumBy('loan_insurance');
    const capInt = inst > 0 ? inst : (prin + inte);
    realDebt += capInt + ins;
  }
  agg.real_debt = round2(realDebt);

  agg.expected_rent = round2(agg.expected_rent);
  agg.th_debt = round2(agg.th_debt);
  agg.real_rent = round2(agg.real_rent);
  agg.real_other_income = round2(agg.real_other_income);
  agg.real_recurring = round2(agg.real_recurring);
  agg.real_exceptional = round2(agg.real_exceptional);
  return agg;
}

export function computeCashflowCompare(input: {
  properties: any[];
  leases?: any[];
  transactions?: any[];
  period: PeriodInput;
}): CompareResult {
  const properties = input.properties || [];
  const leases = input.leases || [];
  const transactions = input.transactions || [];
  const months = monthsForPeriod(input.period);
  const monthsCount = months.length;

  const th = { rent_income: 0, other_income: 0, planned_charges: 0, debt_service: 0, net: 0 };
  const real = {
    rent_income: 0, other_income: 0, operating_expenses: 0,
    recurring_expenses: 0, exceptional_expenses: 0, debt_service: 0, net: 0,
  };
  let coverageMonths = 0;

  for (const { year, month } of months) {
    const agg = aggregateMonth(properties, leases, transactions, year, month);
    if (agg.hasRealTx) coverageMonths += 1;

    th.rent_income += agg.expected_rent;
    th.debt_service += agg.th_debt;

    real.rent_income += agg.real_rent;
    real.other_income += agg.real_other_income;
    real.recurring_expenses += agg.real_recurring;
    real.exceptional_expenses += agg.real_exceptional;
    real.debt_service += agg.real_debt;
  }

  th.net = round2(th.rent_income - th.planned_charges - th.debt_service);
  real.operating_expenses = round2(real.recurring_expenses + real.exceptional_expenses);
  real.net = round2(real.rent_income + real.other_income - real.operating_expenses - real.debt_service);

  for (const k of ['rent_income', 'debt_service'] as const) th[k] = round2(th[k]);
  for (const k of ['rent_income', 'other_income', 'debt_service'] as const) real[k] = round2(real[k]);

  // ── Variance (réel − théorique), décomposée en causes lisibles ──
  const total = round2(real.net - th.net);
  const rentDiff = round2(real.rent_income - th.rent_income);
  const otherIncome = round2(real.other_income); // vs 0 théorique
  const higherCharges = round2(-real.recurring_expenses); // vs charges prévues (0)
  const exceptional = round2(-real.exceptional_expenses);
  const debtDiff = round2(-(real.debt_service - th.debt_service));
  const items: VarianceItem[] = [];
  if (Math.abs(rentDiff) > 0.01) {
    items.push({
      kind: rentDiff < 0 ? 'missing_rent' : 'extra_rent',
      label: rentDiff < 0 ? 'Loyer manquant / partiel' : 'Loyer supplémentaire encaissé',
      amount: rentDiff,
    });
  }
  if (Math.abs(otherIncome) > 0.01) {
    items.push({ kind: 'other_income', label: 'Autres revenus (CAF, régul.)', amount: otherIncome });
  }
  if (Math.abs(higherCharges) > 0.01) {
    items.push({ kind: 'higher_charges', label: 'Charges d’exploitation plus élevées que prévu', amount: higherCharges });
  }
  if (Math.abs(exceptional) > 0.01) {
    items.push({ kind: 'exceptional_expense', label: 'Dépense exceptionnelle', amount: exceptional });
  }
  if (Math.abs(debtDiff) > 0.01) {
    items.push({ kind: 'debt_diff', label: 'Prêt différent (service de la dette)', amount: debtDiff });
  }
  const explained = round2(items.reduce((s, it) => s + it.amount, 0));
  if (Math.abs(total - explained) > 0.01) {
    items.push({ kind: 'other', label: 'Autres écarts', amount: round2(total - explained) });
  }

  const complete = monthsCount > 0 && coverageMonths === monthsCount;
  const partial = monthsCount > 0 && coverageMonths < monthsCount;

  // ── Performance (mêmes formules que le cockpit, aucune formule Banque) ──
  let acq = 0, inv = 0;
  for (const p of properties) { acq += acquisitionCost(p); inv += investedCapital(p); }

  const basisReal = coverageMonths > 0 ? coverageMonths : 1;
  const annualizedRealIncome = round2(real.rent_income * 12 / basisReal);
  const annualizedRealNet = round2(real.net * 12 / basisReal);
  const annualizedThIncome = round2(th.rent_income * 12 / monthsCount);
  const annualizedThNet = round2(th.net * 12 / monthsCount);

  const performance = {
    real: {
      grossYield: acq > 0 ? round2((annualizedRealIncome / acq) * 100) : 0,
      netYield: acq > 0 ? round2((annualizedRealNet / acq) * 100) : 0,
      netNetYield: inv > 0 ? round2((annualizedRealNet / inv) * 100) : 0,
      annualized: monthsCount !== basisReal,
      basisMonths: basisReal,
    },
    theoretical: {
      grossYield: acq > 0 ? round2((annualizedThIncome / acq) * 100) : 0,
      netYield: acq > 0 ? round2((annualizedThNet / acq) * 100) : 0,
      netNetYield: inv > 0 ? round2((annualizedThNet / inv) * 100) : 0,
    },
  };

  return {
    period: {
      kind: input.period.kind,
      label: periodLabel(input.period),
      monthsCount,
      coverageMonths,
      complete,
      partial,
    },
    theoretical: th,
    real,
    variance: { total, items },
    performance,
  };
}