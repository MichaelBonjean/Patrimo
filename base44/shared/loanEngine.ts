/**
 * MOTEUR DE CRÉDIT IMMOBILIER UNIQUE — source de vérité de tout calcul de prêt.
 *
 * Toute la carte (amortissement, CRD, mensualité) et tous les écrans
 * (AmortizationTable, PropertyRow, Dashboard, Analyse via financeEngine,
 *  PropertyDetail, rapports PDF) doivent appeler CE moteur. Aucun recomptage
 *  de l'amortissement ou du CRD ailleurs.
 *
 * Gère correctement :
 *   - taux = 0 % (mensualité = capital / durée d'amortissement, sans division par zéro) ;
 *   - taux > 0 (formule constantielle classique) ;
 *   - mensualité calculée OU saisie manuellement (fournie via `monthly_payment`) ;
 *   - différé d'amortissement (mois où seule l'assurance / les intérêts sont dus) ;
 *   - assurance mensuelle (ajoutée à chaque échéance, neutre sur le CRD) ;
 *   - dates de départ les 28/29/30/31 (sans débordement setMonth : clamp au dernier
 *     jour du mois cible, ex. 31/01 + 1 mois → 28/02 ou 29/02) ;
 *   - remboursement anticipé éventuel (`early_repayments`) qui réduit le CRD et
 *     raccourcit la durée (mensualité inchangée, intérêts recalculés sur le nouveau CRD).
 *
 * Pour chaque échéance produite :
 *   numéro, date, capital début, intérêts, capital amorti, assurance, échéance, CRD.
 */

export interface EarlyRepayment {
  /** Numéro d'échéance (1-based) à laquelle le remboursement anticipé est appliqué. */
  month: number;
  /** Montant remboursé par anticipation (capital seul). */
  amount: number;
}

export interface LoanInput {
  loan_amount?: number | null;
  /** Taux annuel en %. 0 = prêt à taux zéro. */
  loan_rate?: number | null;
  /** Durée en années. */
  loan_duration_years?: number | null;
  /** Date de début (ISO YYYY-MM-DD). La 1ʳᵉ échéance tombe à cette date. */
  loan_start_date?: string | null;
  /** Mois de différé d'amortissement (intérêts seulement, capital constant). */
  loan_deferred_months?: number | null;
  /** Mensualité hors assurance saisie manuellement. Si ≤ 0, Calculée par formule. */
  monthly_payment?: number | null;
  /** Assurance prêt mensuelle (€). Ajoutée à chaque échéance, neutre sur le CRD. */
  monthly_insurance?: number | null;
  /** Remboursements anticipés (capital seul), indexés par numéro d'échéance. */
  early_repayments?: EarlyRepayment[] | null;
}

export interface Installment {
  /** Numéro d'échéance (1-based). */
  number: number;
  /** Date d'échéance (locale, clampée pour 28/29/30/31). */
  date: Date;
  /** Capital dû en début de période. */
  beginCapital: number;
  /** Intérêts de la période. */
  interest: number;
  /** Capital amorti sur la période (principal remboursé, hors anticipation). */
  principal: number;
  /** Assurance de la période. */
  insurance: number;
  /** Échéance totale payée = principal + intérêts + assurance (intérêts-seul en différé). */
  payment: number;
  /** Remboursement anticipé appliqué en fin de période (capital seul), 0 sinon. */
  earlyRepayment: number;
  /** Capital restant dû après l'échéance (CRD). */
  remaining: number;
  /** Période de différé (intérêts seulement). */
  isDeferred: boolean;
}

export interface ScheduleTotals {
  totalInterest: number;
  totalInsurance: number;
  totalPrincipal: number;
  totalEarlyRepayment: number;
  totalPaid: number; // somme des échéances
  count: number;
}

export interface SchedulePoint {
  interest: number;
  capital: number; // capital amorti ce mois
  installment: number; // mensualité hors assurance (principal + intérêts)
  remainingAfter: number;
}

const EPS = 0.005; // 1/2 centime
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Ajoute `months` mois à `startDate` en clampant le jour au dernier jour du
 * mois cible — évite le débordement JS Date (31/01 + 1 → 28/02, 31/03 + 1 → 31/05).
 */
export function addMonthsClamped(startDate: Date | string, months: number): Date {
  const base = startDate instanceof Date ? new Date(startDate.getTime()) : new Date(startDate);
  if (isNaN(base.getTime())) return base;
  const day = base.getDate();
  // On part du 1er du mois cible pour reconstruire sans débordement.
  const target = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  // Préserve l'heure d'origine (minuit local) — pas de glissement UTC.
  return target;
}

function hasLoanData(loan: LoanInput): boolean {
  return !!(
    loan &&
    Number(loan.loan_amount) > 0 &&
    Number(loan.loan_duration_years) > 0 &&
    loan.loan_start_date
  );
}

/**
 * Mensualité d'amortissement calculée par formule (hors assurance, hors différé).
 *   - taux > 0 : M = K·i·(1+i)^n / ((1+i)^n − 1)
 *   - taux = 0 : M = K / n
 * `n` = mois d'amortissement = durée totale − mois de différé.
 */
export function computeMonthlyPayment(loan: LoanInput): number {
  if (!hasLoanData(loan)) return 0;
  const capital = Number(loan.loan_amount);
  const monthlyRate = Number(loan.loan_rate || 0) / 100 / 12;
  const n = Math.max(1, Math.round(Number(loan.loan_duration_years) * 12) - Number(loan.loan_deferred_months || 0));
  if (monthlyRate === 0) return round2(capital / n);
  const f = Math.pow(1 + monthlyRate, n);
  return round2((capital * monthlyRate * f) / (f - 1));
}

/**
 * Mensualité effective utilisée par l'échéancier : celle saisie manuellement
 * si > 0, sinon la mensualité calculée par formule.
 */
export function getMonthlyPayment(loan: LoanInput): number {
  const manual = Number(loan?.monthly_payment || 0);
  return manual > 0 ? manual : computeMonthlyPayment(loan);
}

/**
 * Construit l'échéancier d'amortissement complet.
 *
 * La boucle s'arrête quand le CRD tombe à zéro (le prêt peut se terminer avant
 * la durée nominale si la mensualité est supérieure à la formule, ou après si
 * inférieure). Un garde-fou d'itérations protège contre une mensualité trop
 * faible qui ne couvrirait pas les intérêts.
 */
// Cache de l'échéancier amorti par signature de prêt : buildSchedule est pur et
// appelé de nombreuses fois pour un même bien (CRD + 12×2 découpe mensuelle dans
// financeEngine). On évite de reconstruire l'amortissement complet à chaque appel.
const scheduleCache = new Map<string, Installment[]>();
function loanSignature(loan: LoanInput): string {
  return [
    Number(loan.loan_amount) || 0,
    Number(loan.loan_rate) || 0,
    Number(loan.loan_duration_years) || 0,
    loan.loan_start_date || '',
    Number(loan.loan_deferred_months) || 0,
    Number(loan.monthly_payment) || 0,
    Number(loan.monthly_insurance) || 0,
    JSON.stringify(loan.early_repayments || []),
  ].join('|');
}

export function buildSchedule(loan: LoanInput): Installment[] {
  if (!hasLoanData(loan)) return [];
  const sig = loanSignature(loan);
  const cached = scheduleCache.get(sig);
  if (cached) return cached;
  const capital = Number(loan.loan_amount);
  const monthlyRate = Number(loan.loan_rate || 0) / 100 / 12;
  const n = Math.round(Number(loan.loan_duration_years) * 12);
  const deferred = Math.max(0, Math.min(Number(loan.loan_deferred_months || 0), n));
  const amortizingN = Math.max(1, n - deferred);
  const insurance = Number(loan.monthly_insurance || 0);
  // Mensualité en précision brute (non arrondie) pour éviter une échéance
  // résiduelle due à l'accumulation d'arrondis. Saisie manuelle sinon formule.
  const manualM = Number(loan.monthly_payment || 0);
  const M =
    manualM > 0
      ? manualM
      : monthlyRate === 0
        ? capital / amortizingN
        : (capital * monthlyRate * Math.pow(1 + monthlyRate, amortizingN)) /
          (Math.pow(1 + monthlyRate, amortizingN) - 1);
  const start = new Date(loan.loan_start_date as string);
  if (isNaN(start.getTime())) return [];

  const earlyMap = new Map<number, number>();
  for (const e of loan.early_repayments || []) {
    if (e && e.month > 0 && Number(e.amount) > 0) {
      earlyMap.set(e.month, (earlyMap.get(e.month) || 0) + Number(e.amount));
    }
  }

  const rows: Installment[] = [];
  let remaining = capital;
  // Garde-fou : au plus la durée nominale + 60 ans de marge (improbable).
  const maxIter = n + 12 * 60;

  for (let i = 0; i < maxIter; i++) {
    const date = addMonthsClamped(start, i);
    const isDeferred = i < deferred;
    const beginCapital = remaining; // précision brute
    const rawInterest = remaining * monthlyRate;
    const interest = round2(rawInterest);
    const ins = round2(insurance);
    let principal = 0;
    let paymentCapitalInterest = 0; // hors assurance

    if (isDeferred) {
      // Différé d'amortissement : intérêts seuls, capital constant.
      principal = 0;
      paymentCapitalInterest = round2(rawInterest);
    } else {
      let p = M - rawInterest; // précision brute
      if (p < 0) p = 0; // mensualité < intérêts → pas d'amortissement ce mois
      // Clôture exacte : on solde le capital restant (dernière échéance ou si
      // le reliquat d'arrondi est < 1 centime).
      if (remaining - p <= 0.01 && p > 0) p = remaining;
      if (p > remaining) p = remaining;
      principal = round2(p);
      paymentCapitalInterest = principal + interest; // échéance hors assurance = capital + intérêts
      remaining = remaining - p; // précision brute
    }

    // Remboursement anticipé (capital seul) appliqué en fin de période.
    const earlyRaw = Math.min(earlyMap.get(i + 1) || 0, Math.max(0, remaining));
    const early = round2(earlyRaw);
    if (early > 0) remaining = remaining - earlyRaw;

    const remainingDisplay = remaining < EPS ? 0 : round2(remaining);

    rows.push({
      number: i + 1,
      date,
      beginCapital: round2(beginCapital),
      interest,
      principal,
      insurance: ins,
      payment: round2(paymentCapitalInterest + ins),
      earlyRepayment: early,
      remaining: remainingDisplay,
      isDeferred,
    });

    if (remaining <= 0 && !isDeferred) break;
    // En différé le CRD ne bouge pas : on continue jusqu'à la fin du différé.
    if (remaining <= 0 && isDeferred && i >= deferred - 1) break;
  }

  if (scheduleCache.size > 1000) {
    scheduleCache.delete(scheduleCache.keys().next().value as string);
  }
  scheduleCache.set(sig, rows);
  return rows;
}

/**
 * Capital restant dû à une date donnée (par défaut : aujourd'hui).
 * Renvoie 0 si le prêt n'est pas commencé ou déjà soldé, ou sans données de prêt.
 */
export function currentCRD(loan: LoanInput, atDate: Date = new Date()): number {
  if (!hasLoanData(loan)) return 0;
  const schedule = buildSchedule(loan);
  if (schedule.length === 0) return 0;
  const at = atDate instanceof Date ? atDate : new Date(atDate);
  if (isNaN(at.getTime())) return 0;

  // Convention : une échéance est « payée » une fois son mois écoulé (date
  // strictement avant la date d'observation). Au jour J de l'échéance, elle
  // n'est pas encore comptée (CRD = reste après l'échéance précédente).
  if (at <= schedule[0].date) return Number(loan.loan_amount);
  if (at > schedule[schedule.length - 1].date) return 0;

  let crd = Number(loan.loan_amount);
  for (const row of schedule) {
    if (row.date < at) crd = row.remaining;
    else break;
  }
  return crd;
}

/**
 * Point d'amortissement pour un (year, month) donné — utilisé par le moteur
 * de cash-flow (financeEngine) pour découper capital/intérêts d'une échéance.
 * Renvoie null si la période est hors plage ou sans données de prêt.
 */
export function scheduleAtPeriod(loan: LoanInput, year: number, month: number): SchedulePoint | null {
  if (!hasLoanData(loan)) return null;
  const schedule = buildSchedule(loan);
  const row = schedule.find(
    (r) => r.date.getFullYear() === year && r.date.getMonth() + 1 === month
  );
  if (!row) return null;
  return {
    interest: row.interest,
    capital: row.principal,
    installment: round2(row.principal + row.interest),
    remainingAfter: row.remaining,
  };
}

/** Totaux d'un échéancier. */
export function scheduleTotals(schedule: Installment[]): ScheduleTotals {
  const t: ScheduleTotals = {
    totalInterest: 0,
    totalInsurance: 0,
    totalPrincipal: 0,
    totalEarlyRepayment: 0,
    totalPaid: 0,
    count: schedule.length,
  };
  for (const r of schedule) {
    t.totalInterest += r.interest;
    t.totalInsurance += r.insurance;
    t.totalPrincipal += r.principal;
    t.totalEarlyRepayment += r.earlyRepayment;
    t.totalPaid += r.payment;
  }
  t.totalInterest = round2(t.totalInterest);
  t.totalInsurance = round2(t.totalInsurance);
  t.totalPrincipal = round2(t.totalPrincipal);
  t.totalEarlyRepayment = round2(t.totalEarlyRepayment);
  t.totalPaid = round2(t.totalPaid);
  return t;
}