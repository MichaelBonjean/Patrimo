/**
 * MOTEUR FINANCIER UNIQUE — source de vérité de tout calcul de cash-flow.
 *
 * Aucun écran / rapport / tableau ne doit recompter le cash-flow lui-même :
 * tous appellent `computePropertyCashflow` / `computePortfolioCashflow`.
 *
 * Définitions canoniques (par période = mois) :
 *
 *   OPERATING_INCOME      = revenus d'exploitation encaissés
 *                          (loyer, charges locataire, CAF, régul. charges, autres revenus)
 *   OPERATING_EXPENSES    = charges d'exploitation décaissées (hors prêt)
 *                          (assurances, taxes, charges de copropriété, gestion, travaux,
 *                           énergie, entretien, frais SCI, etc.)
 *   NET_OPERATING_CASHFLOW = OPERATING_INCOME − OPERATING_EXPENSES
 *   DEBT_SERVICE          = service de la dette (capital + intérêts + assurance prêt)
 *                          — traité UNE SEULE FOIS, jamais ajouté à la mensualité théorique.
 *   NET_CASHFLOW          = NET_OPERATING_CASHFLOW − DEBT_SERVICE
 *
 * Règle anti-double-comptage du crédit (convention canonique des 4 catégories) :
 *
 *   loan_installment = mensualité globale (capital + intérêts, hors assurance)
 *   loan_principal   = part capital (ventilation)     ┐ alternative à
 *   loan_interest    = part intérêts (ventilation)    ┘ loan_installment
 *   loan_insurance   = assurance prêt (distincte, jamais comptée 2x)
 *
 *   - On sélectionne TOUJOURS par CLÉ EXACTE (loan_installment, loan_principal,
 *     loan_interest, loan_insurance), jamais par bucket `debt_service` générique
 *     pour pointer une transaction précise (sinon l'assurance, membre du bucket,
 *     serait comptée comme une mensualité → double comptage).
 *   - capital+intérêts = Σ(loan_installment) si présentes, SINON
 *     Σ(loan_principal) + Σ(loan_interest). Si loan_installment ET ventilation
 *     coexistent, loan_installment fait foi (la ventilation ne sert qu'à
 *     détailler capital/intérêts) — jamais la somme des deux.
 *   - assurance = Σ(loan_insurance), distincte.
 *   - Toutes les sommes utilisent filter/reduce (jamais `.find()`) pour gérer
 *     plusieurs prêts et plusieurs transactions par catégorie/mois.
 *   - Fallback théorique (mensualité/assurance du bien) UNIQUEMENT si AUCUNE
 *     transaction de dette n'existe pour le mois : une vraie transaction de dette
 *     (même seule, ex. assurance) supprime l'ajout théorique sur la période.
 *
 * Flux EXCLUDED (hors cash-flow d'exploitation, restitués séparément) :
 *   - Dépôts de garantie reçus/restitués (postes de bilan, pas de résultat)
 *   - Virements internes inter-comptes (mouvements neutres)
 *   - Apports / remboursements / provisions (non consommables)
 *   - Amortissement (non-décaissé)
 *   - Taxes (IS/IR, TVA) — versées sur le résultat, pas sur l'exploitation
 *
 * Le capital remboursé du prêt n'est JAMAIS déductible d'un résultat fiscal ;
 * seul l'intérêt l'est (cf. taxEngine). Ici on isole capital / intérêts /
 * assurance à des fins de transparence et de cohérence avec le moteur fiscal.
 */

import { resolveKey, cashflowBucketOf, directionOf } from './financeCategories.ts';
import type { CashflowBucket } from './financeCategories.ts';
import { scheduleAtPeriod as loanScheduleAtPeriod } from './loanEngine.ts';

export interface DebtServiceSplit {
  total: number;       // capital + interest + insurance
  capital: number;      // remboursement de capital
  interest: number;     // intérêts de la période
  insurance: number;    // assurance prêt (hors capital/intérêts)
  source: 'transaction' | 'theoretical' | 'none';
}

export interface MonthCashflow {
  month: number;        // 1-12
  operating_income: number;
  operating_expenses: number;
  net_operating: number;   // operating_income − operating_expenses
  debt_service: DebtServiceSplit;
  net_cashflow: number;    // net_operating − debt_service.total
  excluded: { amount: number; breakdown: Record<string, number> };
  operating_income_breakdown: Record<string, number>;
  operating_expenses_breakdown: Record<string, number>;
}

export interface PropertyCashflowTotals {
  operating_income: number;
  operating_expenses: number;
  net_operating: number;
  debt_service: DebtServiceSplit;
  net_cashflow: number;
  excluded: { amount: number; breakdown: Record<string, number> };
  monthly_average_net_cashflow: number; // net_cashflow / 12
}

export interface PropertyCashflow {
  propertyId: string;
  year: number;
  monthly: MonthCashflow[];           // 12 entrées (index 0 = janvier)
  totals: PropertyCashflowTotals;
  warnings: string[];
  loan: {
    used: 'transaction' | 'theoretical' | 'none';
    monthly_installment_theoretical: number;
    monthly_insurance_theoretical: number;
  };
}

export interface PortfolioCashflow {
  perProperty: PropertyCashflow[];
  monthly: MonthCashflow[];       // 12 entrées (somme des biens), index 0 = janvier
  totals: PropertyCashflowTotals;
  warnings: string[];
}

// ── Helpers internes ────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const abs = (n: number | null | undefined) => Math.abs(Number(n) || 0);

interface LoanSchedulePoint {
  interest: number;
  capital: number;        // part de capital remboursée ce mois (selon amortissement théorique)
  installment: number;    // mensualité théorique hors assurance
  remainingAfter: number;
}

/**
 * Échéancier d'amortissement théorique pour un mois donné. Délègue au moteur
 * de crédit canonique (loanEngine) — gère taux 0, différé, assurance, mensualité
 * manuelle et dates 28/29/30/31. Sert uniquement à découper capital/intérêts et
 * à fournir la mensualité théorique de fallback quand aucune transaction prêt
 * n'existe.
 */
function loanScheduleAt(property: any, year: number, month: number): LoanSchedulePoint | null {
  const pt = loanScheduleAtPeriod(property, year, month);
  if (!pt) return null;
  return {
    interest: pt.interest,
    capital: pt.capital,
    installment: pt.installment,
    remainingAfter: pt.remainingAfter,
  };
}

function emptyDebt(): DebtServiceSplit {
  return { total: 0, capital: 0, interest: 0, insurance: 0, source: 'none' };
}

function emptyMonth(month: number): MonthCashflow {
  return {
    month,
    operating_income: 0,
    operating_expenses: 0,
    net_operating: 0,
    debt_service: emptyDebt(),
    net_cashflow: 0,
    excluded: { amount: 0, breakdown: {} },
    operating_income_breakdown: {},
    operating_expenses_breakdown: {},
  };
}

// ── API publique ───────────────────────────────────────────────────────────

/**
 * Calcule le cash-flow canonique d'un bien pour une année.
 *
 * @param property     Entité Property (champs loan_* utilisés pour le fallback).
 * @param transactions Transactions du bien pour `year` (on filtre year par sécurité).
 * @param year         Année fiscale.
 */
export function computePropertyCashflow(
  property: any,
  transactions: any[],
  year: number
): PropertyCashflow {
  const propertyId = property?.id || '';
  const warnings: string[] = [];
  const tx = (transactions || []).filter(
    (t) => t.property_id === propertyId && Number(t.year) === Number(year)
  );

  const monthly: MonthCashflow[] = Array.from({ length: 12 }, (_, i) => emptyMonth(i + 1));

  // Compteur de parts de prêt (pour décision transaction vs théorique)
  let txInstallmentCount = 0;   // mois avec ≥1 transaction loan_installment réelle
  let txInsuranceCount = 0;    // mois avec ≥1 transaction loan_insurance réelle
  let anyTxDebt = false;         // au moins 1 mois avec une dette réelle (toute catégorie)
  const theoreticalInstallment =
    property?.monthly_payment && property.monthly_payment > 0
      ? property.monthly_payment
      : loanScheduleAt(property, year, 1)?.installment || 0;
  const theoreticalInsurance = property?.monthly_insurance || 0;

  for (let m = 1; m <= 12; m++) {
    const cell = monthly[m - 1];

    for (const t of tx) {
      if (Number(t.month) !== m) continue;
      const key = resolveKey(t.category);
      const bucket = cashflowBucketOf(key);
      const amount = abs(t.amount);

      // Service de la dette : géré plus bas (anti-double-comptage).
      if (bucket === 'debt_service') continue;

      if (bucket === 'operating_income') {
        cell.operating_income += amount;
        cell.operating_income_breakdown[key] = (cell.operating_income_breakdown[key] || 0) + amount;
        continue;
      }

      if (bucket === 'operating_expense') {
        cell.operating_expenses += amount;
        cell.operating_expenses_breakdown[key] = (cell.operating_expenses_breakdown[key] || 0) + amount;
        continue;
      }

      // Excluded : dépôts, virements internes, provisions, remboursements,
      // amortissement (non-décaissé), taxes (IS/IR, TVA).
      // Signé selon le flux ÉCONOMIQUE réel (t.type) — un virement interne
      // entrant (compte destinataire) est une entrée réelle, sortant une sortie
      // réelle. Une paire sortant+entrant s'annule donc net = 0 en consolidé.
      const signed = t.type === 'income' ? amount : -amount;
      cell.excluded.amount += signed;
      cell.excluded.breakdown[key] = (cell.excluded.breakdown[key] || 0) + signed;
    }

    // ── Service de la dette ── (cf. convention canonique en tête de fichier)
    // On rassemble les transactions de dette du mois (bucket) puis on sélectionne
    // par CLÉ EXACTE pour les sommes — jamais `.find()` sur le bucket générique
    // (evite de confondre l'assurance avec une mensualité).
    const monthDebtTx = tx.filter(
      (t) => Number(t.month) === m && t.type === 'expense' && cashflowBucketOf(resolveKey(t.category)) === 'debt_service'
    );
    const sumBy = (key: string): number =>
      monthDebtTx
        .filter((t) => resolveKey(t.category) === key)
        .reduce((s, t) => s + abs(t.amount), 0);
    const realInstallment = sumBy('loan_installment');
    const realPrincipal   = sumBy('loan_principal');
    const realInterest     = sumBy('loan_interest');
    const realInsurance    = sumBy('loan_insurance');
    const hasRealDebt =
      realInstallment > 0 || realPrincipal > 0 || realInterest > 0 || realInsurance > 0;

    let capitalInterest = 0; // capital + intérêts du mois (hors assurance)
    let capital = 0;
    let interest = 0;
    let insurance = 0;
    let source: DebtServiceSplit['source'] = 'none';

    if (hasRealDebt) {
      // Vraie dette enregistrée ce mois → on n'ajoute JAMAIS de théorique.
      anyTxDebt = true;
      source = 'transaction';
      if (realInstallment > 0) {
        txInstallmentCount++;
        capitalInterest = realInstallment;
        const ventilation = realPrincipal + realInterest;
        if (ventilation > 0 && Math.abs(ventilation - capitalInterest) < 0.01) {
          // Ventilation cohérente → on l'utilise pour détailler.
          capital = realPrincipal;
          interest = realInterest;
        } else {
          const sched = loanScheduleAt(property, year, m);
          if (sched && sched.interest <= capitalInterest) {
            interest = sched.interest;
            capital = Math.max(0, capitalInterest - interest);
          } else {
            capital = capitalInterest;
          }
        }
      } else if (realPrincipal > 0 || realInterest > 0) {
        // Ventilation seule (pas de mensualité globale).
        capitalInterest = realPrincipal + realInterest;
        capital = realPrincipal;
        interest = realInterest;
      }
      if (realInsurance > 0) {
        insurance = realInsurance;
        txInsuranceCount++;
      }
    } else {
      // Aucune transaction de dette ce mois → fallback théorique du prêt.
      const sched = loanScheduleAt(property, year, m);
      const thInst = sched ? sched.installment : (theoreticalInstallment > 0 ? theoreticalInstallment : 0);
      const thIns = theoreticalInsurance;
      if (thInst > 0 || thIns > 0) {
        capitalInterest = thInst;
        insurance = thIns;
        if (sched && sched.interest <= capitalInterest) {
          interest = sched.interest;
          capital = Math.max(0, capitalInterest - interest);
        } else {
          capital = capitalInterest;
        }
        source = 'theoretical';
      }
    }

    if (capitalInterest === 0 && insurance === 0) {
      cell.debt_service = emptyDebt();
    } else {
      cell.debt_service = {
        total: round2(capitalInterest + insurance),
        capital: round2(capital),
        interest: round2(interest),
        insurance: round2(insurance),
        source,
      };
    }

    cell.operating_income = round2(cell.operating_income);
    cell.operating_expenses = round2(cell.operating_expenses);
    cell.net_operating = round2(cell.operating_income - cell.operating_expenses);
    cell.net_cashflow = round2(cell.net_operating - cell.debt_service.total);
  }

  // ── Totaux annuels ──
  const totals: PropertyCashflowTotals = {
    operating_income: round2(monthly.reduce((s, c) => s + c.operating_income, 0)),
    operating_expenses: round2(monthly.reduce((s, c) => s + c.operating_expenses, 0)),
    net_operating: 0,
    debt_service: { total: 0, capital: 0, interest: 0, insurance: 0, source: 'none' },
    net_cashflow: 0,
    excluded: { amount: 0, breakdown: {} },
    monthly_average_net_cashflow: 0,
  };
  totals.net_operating = round2(totals.operating_income - totals.operating_expenses);
  totals.debt_service = {
    total: round2(monthly.reduce((s, c) => s + c.debt_service.total, 0)),
    capital: round2(monthly.reduce((s, c) => s + c.debt_service.capital, 0)),
    interest: round2(monthly.reduce((s, c) => s + c.debt_service.interest, 0)),
    insurance: round2(monthly.reduce((s, c) => s + c.debt_service.insurance, 0)),
    source: anyTxDebt ? 'transaction' : theoreticalInstallment > 0 || theoreticalInsurance > 0 ? 'theoretical' : 'none',
  };
  totals.net_cashflow = round2(totals.net_operating - totals.debt_service.total);
  totals.monthly_average_net_cashflow = round2(totals.net_cashflow / 12);

  // Excluded (net) totals
  const excl = { amount: 0, breakdown: {} as Record<string, number> };
  for (const c of monthly) {
    excl.amount += c.excluded.amount;
    for (const [k, v] of Object.entries(c.excluded.breakdown)) {
      excl.breakdown[k] = (excl.breakdown[k] || 0) + v;
    }
  }
  excl.amount = round2(excl.amount);
  totals.excluded = excl;

  // ── Warnings (transparence) ──
  if (txInstallmentCount > 0 && theoreticalInstallment > 0) {
    warnings.push(
      `Présence de ${txInstallmentCount} transaction(s) « Échéance prêt » : la mensualité théorique du bien (${theoreticalInstallment}€) est ignorée pour éviter le double comptage du crédit.`
    );
  }
  if (txInstallmentCount > 0 && txInstallmentCount < 12) {
    warnings.push(
      `Mois sans transaction prêt (${12 - txInstallmentCount}/12) : la mensualité théorique est utilisée par défaut pour ces mois.`
    );
  }

  return {
    propertyId,
    year,
    monthly,
    totals,
    warnings,
    loan: {
      used: anyTxDebt ? 'transaction' : theoreticalInstallment > 0 || theoreticalInsurance > 0 ? 'theoretical' : 'none',
      monthly_installment_theoretical: round2(theoreticalInstallment),
      monthly_insurance_theoretical: round2(theoreticalInsurance),
    },
  };
}

/**
 * Calcule le cash-flow canonique d'un portefeuille (somme des biens).
 * Les transactions peuvent couvrir plusieurs biens ; elles sont ventilées
 * par `property_id`.
 */
export function computePortfolioCashflow(
  properties: any[],
  transactions: any[],
  year: number
): PortfolioCashflow {
  const perProperty = (properties || []).map((p) =>
    computePropertyCashflow(p, transactions || [], year)
  );

  const totals: PropertyCashflowTotals = {
    operating_income: 0,
    operating_expenses: 0,
    net_operating: 0,
    debt_service: { total: 0, capital: 0, interest: 0, insurance: 0, source: 'none' },
    net_cashflow: 0,
    excluded: { amount: 0, breakdown: {} },
    monthly_average_net_cashflow: 0,
  };

  const monthly: MonthCashflow[] = Array.from({ length: 12 }, (_, i) => emptyMonth(i + 1));

  for (const pc of perProperty) {
    totals.operating_income += pc.totals.operating_income;
    totals.operating_expenses += pc.totals.operating_expenses;
    totals.debt_service.total += pc.totals.debt_service.total;
    totals.debt_service.capital += pc.totals.debt_service.capital;
    totals.debt_service.interest += pc.totals.debt_service.interest;
    totals.debt_service.insurance += pc.totals.debt_service.insurance;
    totals.excluded.amount += pc.totals.excluded.amount;
    for (const [k, v] of Object.entries(pc.totals.excluded.breakdown)) {
      totals.excluded.breakdown[k] = (totals.excluded.breakdown[k] || 0) + v;
    }
    for (let i = 0; i < 12; i++) {
      monthly[i].operating_income += pc.monthly[i].operating_income;
      monthly[i].operating_expenses += pc.monthly[i].operating_expenses;
      monthly[i].net_operating += pc.monthly[i].net_operating;
      monthly[i].debt_service.total += pc.monthly[i].debt_service.total;
      monthly[i].debt_service.capital += pc.monthly[i].debt_service.capital;
      monthly[i].debt_service.interest += pc.monthly[i].debt_service.interest;
      monthly[i].debt_service.insurance += pc.monthly[i].debt_service.insurance;
      monthly[i].net_cashflow += pc.monthly[i].net_cashflow;
    }
  }

  totals.operating_income = round2(totals.operating_income);
  totals.operating_expenses = round2(totals.operating_expenses);
  totals.net_operating = round2(totals.operating_income - totals.operating_expenses);
  totals.debt_service.total = round2(totals.debt_service.total);
  totals.debt_service.capital = round2(totals.debt_service.capital);
  totals.debt_service.interest = round2(totals.debt_service.interest);
  totals.debt_service.insurance = round2(totals.debt_service.insurance);
  totals.debt_service.source = perProperty.some((p) => p.loan.used === 'transaction')
    ? 'transaction'
    : perProperty.some((p) => p.loan.used === 'theoretical')
      ? 'theoretical'
      : 'none';
  totals.net_cashflow = round2(totals.net_operating - totals.debt_service.total);
  totals.monthly_average_net_cashflow = round2(totals.net_cashflow / 12);
  totals.excluded.amount = round2(totals.excluded.amount);

  // Arrondis finaux des agrégats mensuels (somme des biens)
  for (let i = 0; i < 12; i++) {
    monthly[i].operating_income = round2(monthly[i].operating_income);
    monthly[i].operating_expenses = round2(monthly[i].operating_expenses);
    monthly[i].net_operating = round2(monthly[i].operating_income - monthly[i].operating_expenses);
    monthly[i].debt_service.total = round2(monthly[i].debt_service.total);
    monthly[i].debt_service.capital = round2(monthly[i].debt_service.capital);
    monthly[i].debt_service.interest = round2(monthly[i].debt_service.interest);
    monthly[i].debt_service.insurance = round2(monthly[i].debt_service.insurance);
    monthly[i].net_cashflow = round2(monthly[i].net_operating - monthly[i].debt_service.total);
  }

  return {
    perProperty,
    monthly,
    totals,
    warnings: perProperty.flatMap((p) => p.warnings.map((w) => `${p.propertyId}: ${w}`)),
  };
}

/** Variante mensuelle (pour les graphiques) : net_cashflow par mois pour l'année. */
export function monthlyNetCashflowSeries(cf: PropertyCashflow | PortfolioCashflow): number[] {
  const monthly: MonthCashflow[] = (cf as any).monthly ?? [];
  return monthly.map((c) => c.net_cashflow);
}

/** Réutilise la bucket classification pour les consommateurs front (grilles). */
export { cashflowBucketOf, resolveKey, directionOf };
export type { CashflowBucket };