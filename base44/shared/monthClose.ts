/**
 * MOTEUR DE CLÔTURE MENSUELLE — analyse consolidée d'un mois.
 *
 * Réutilise financeEngine (cash-flow canonique), financeCategories (résolution),
 * lease (loyers effectifs). Aucun recomptage. Aucune approximation de
 * rapprochement bancaire : on s'appuie sur l'état réel des échéances
 * (RentDue.statut), paiements (Payment), impayés (Impaye), quittances
 * (Quittance) et transactions bancaires (BankTransaction).
 *
 * Sortie : résumé exploité par le wizard « Clôturer mon mois ».
 */
import { computePortfolioCashflow } from './financeEngine.ts';
import { resolveKey } from './financeCategories.ts';

const R2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');

export interface MonthSummary {
  period: string;
  year: number;
  month: number;
  duesCount: number;
  expectedRent: number;
  collectedRent: number;
  encaissementRate: number;
  bankTxCount: number;
  bankPending: number;
  bankLinked: number;
  cafAmount: number;
  cafCount: number;
  partialCount: number;
  impayeCount: number;
  impayeAmount: number;
  quittanceCount: number;
  quittanceSent: number;
  quittanceUnsent: number;
  uncategorizedCount: number;
  uncategorizedAmount: number;
  operatingIncome: number;
  operatingExpenses: number;
  debtService: number;
  cashflow: number;
  toVerifyCount: number;
}

export async function analyzeMonth(svc: any, owner: string, year: number, month: number): Promise<MonthSummary> {
  const period = `${year}-${pad(month)}`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthStart = `${period}-01`;
  const monthEnd = `${period}-${pad(lastDay)}`;

  const [properties, lots, leases, rentDues, payments, impayes, quittances, bankTx, transactions] = await Promise.all([
    svc.entities.Property.filter({ owner_id: owner }),
    svc.entities.Lot.filter({ owner_id: owner }),
    svc.entities.Lease.filter({ owner_id: owner }),
    svc.entities.RentDue.filter({ owner_id: owner, year, month }),
    svc.entities.Payment.filter({ owner_id: owner }),
    svc.entities.Impaye.filter({ owner_id: owner, period }),
    svc.entities.Quittance.filter({ owner_id: owner, year, month }),
    svc.entities.BankTransaction.filter({ owner_id: owner }),
    svc.entities.Transaction.filter({ owner_id: owner, year, month }),
  ]);

  // 1. Loyers attendus / encaissés (RentDue ; fallback leases+tx)
  let expectedRent = 0;
  let collectedRent = 0;
  let partialCount = 0;
  if (rentDues.length) {
    for (const d of rentDues) {
      expectedRent += Number(d.total_due) || 0;
      collectedRent += Number(d.paid_amount) || 0;
      if ((d.status || 'unpaid') === 'partial') partialCount++;
    }
  } else {
    // Fallback : loyer HC du lot (bail legacy) + loyers encaissés issus des transactions.
    for (const l of lots) {
      expectedRent += Number(l.rent_excluding_charges) || 0;
    }
    collectedRent = transactions
      .filter((t) => resolveKey(t.category) === 'rent' && t.type === 'income')
      .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0);
  }
  expectedRent = R2(expectedRent);
  collectedRent = R2(collectedRent);
  const encaissementRate = expectedRent > 0 ? (collectedRent / expectedRent) * 100 : 0;

  // 2 & 4. Transactions bancaires & rapprochements
  const bankInMonth = bankTx.filter((b) => b.date && b.date >= monthStart && b.date <= monthEnd);
  const bankTxCount = bankInMonth.length;
  const bankPending = bankInMonth.filter((b) => b.status === 'pending').length;
  const bankLinked = bankInMonth.filter((b) => b.status === 'linked').length;

  // 3. CAF / APL reçus dans le mois
  const cafPayments = payments.filter((p) => p.payer_type === 'caf' && p.date && p.date >= monthStart && p.date <= monthEnd);
  const cafAmount = R2(cafPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const cafCount = cafPayments.length;

  // 6. Impayés actifs de la période
  const activeImp = impayes.filter((i) => i.status !== 'régularisé' && i.status !== 'abandonné');
  const impayeAmount = R2(activeImp.reduce((s, i) => s + (Number(i.missing_amount) || 0), 0));
  const impayeCount = activeImp.length;

  // 7. Quittances du mois
  const quittanceCount = quittances.length;
  const quittanceSent = quittances.filter((q) => q.status === 'sent').length;
  const quittanceUnsent = quittances.filter((q) => q.status !== 'sent').length;

  // 8. Dépenses non catégorisées (clé 'other' / 'other_expense')
  const uncategorized = transactions.filter((t) => {
    const k = resolveKey(t.category);
    return (k === 'other' || k === 'other_expense') && t.type === 'expense';
  });
  const uncategorizedCount = uncategorized.length;
  const uncategorizedAmount = R2(uncategorized.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0));

  // 9. Cash-flow canonique du mois (financeEngine)
  const cf = computePortfolioCashflow(properties, transactions, year);
  const m = cf.monthly[month - 1];
  const operatingIncome = R2(m.operating_income);
  const operatingExpenses = R2(m.operating_expenses);
  const debtService = R2(m.debt_service.total);
  const cashflow = R2(m.net_cashflow);

  const toVerifyCount = bankPending + uncategorizedCount;

  return {
    period, year, month,
    duesCount: rentDues.length,
    expectedRent, collectedRent, encaissementRate,
    bankTxCount, bankPending, bankLinked,
    cafAmount, cafCount,
    partialCount,
    impayeCount, impayeAmount,
    quittanceCount, quittanceSent, quittanceUnsent,
    uncategorizedCount, uncategorizedAmount,
    operatingIncome, operatingExpenses, debtService, cashflow,
    toVerifyCount,
  };
}