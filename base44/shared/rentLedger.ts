/**
 * Moteur de suivi des échéances et paiements de loyer (ledger locatif).
 * Source de vérité partagée par : génération d'échéances, enregistrement de
 * paiements, impayés, quittances, portail locataire, dashboard, rapprochement.
 *
 * Règles métier :
 *  - balance = total_due - paid_amount (peut être < 0 si trop-perçu)
 *  - statuts : unpaid (rien payé), partial (payé < dû), paid (payé = dû),
 *    overpaid (payé > dû)
 *  - un paiement peut être réparti sur plusieurs échéances (allocations[])
 *  - une échéance peut recevoir plusieurs paiements (paid_amount cumulatif)
 *  - affectation auto FIFO : on rembourse les échéances les plus anciennes d'abord,
 *    en plafonnant au solde restant (pas de trop-perçu automatique -> crédit).
 */

export const R2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export const DUE_STATUSES = ['unpaid', 'partial', 'paid', 'overpaid'] as const;

export const PAYER_TYPES = ['tenant', 'caf', 'guarantor', 'insurance', 'other'] as const;

export const PAYMENT_METHODS = ['virement', 'chèque', 'espèces', 'prélèvement', 'caf', 'cb', 'autre'] as const;

/** Statut calculé d'une échéance selon total dû et montant payé. */
export function statusFor(total_due: number, paid_amount: number): string {
  const due = R2(total_due);
  const paid = R2(paid_amount);
  if (paid <= 0) return 'unpaid';
  if (paid < due) return 'partial';
  if (paid === due) return 'paid';
  return 'overpaid';
}

/** Recalcule paid_amount / balance / status d'une échéance. Renvoie une copie. */
export function recalcDue(due: any, paid_amount: number): any {
  const p = R2(paid_amount);
  const balance = R2((Number(due.total_due) || 0) - p);
  return { ...due, paid_amount: p, balance, status: statusFor(due.total_due || 0, p) };
}

/** Clé période YYYY-MM. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Décale un (year, month) de n mois. */
export function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + n, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Date d'échéance (due_day clampé au dernier jour du mois). */
export function dueDateFor(year: number, month: number, dueDay: number): string {
  const last = new Date(year, month, 0).getDate();
  const dd = Math.max(1, Math.min(dueDay || 5, last));
  return `${year}-${String(month).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Affectation FIFO d'un montant sur des échéances (les plus anciennes d'abord),
 * en plafonnant au solde restant de chaque échéance. Aucun trop-perçu :
 * l'excédent éventuel reste en `unallocated` (crédit / avoir).
 */
export function allocateFifo(
  dues: any[],
  amount: number
): { allocations: { rent_due_id: string; amount: number }[]; unallocated: number } {
  const ordered = (dues || [])
    .filter((d) => (d.status || 'unpaid') !== 'paid' && (d.status || 'unpaid') !== 'overpaid')
    .sort((a, b) => String(a.period || '').localeCompare(String(b.period || '')));
  let remaining = R2(amount);
  const allocations: { rent_due_id: string; amount: number }[] = [];
  for (const d of ordered) {
    if (remaining <= 0) break;
    const balance = R2((Number(d.total_due) || 0) - (Number(d.paid_amount) || 0));
    if (balance <= 0) continue;
    const a = Math.min(balance, remaining);
    allocations.push({ rent_due_id: d.id, amount: R2(a) });
    remaining = R2(remaining - a);
  }
  return { allocations, unallocated: remaining };
}

/** Somme des allocations existantes visant une échéance donnée. */
export function allocatedTo(due_id: string, payments: any[]): number {
  let sum = 0;
  for (const p of payments || []) {
    for (const a of p.allocations || []) {
      if (a.rent_due_id === due_id) sum = R2(sum + Number(a.amount) || 0);
    }
  }
  return sum;
}

/** Recalcule toutes les échéances d'un bail à partir de l'ensemble des paiements. */
export function recalcAllDues(dues: any[], payments: any[]): any[] {
  return (dues || []).map((d) => {
    const paid = allocatedTo(d.id, payments);
    return recalcDue(d, paid);
  });
}

/** Solde restant global (somme des balances positives = impayés en cours). */
export function totalOutstanding(dues: any[]): number {
  return (dues || []).reduce((s, d) => s + Math.max(0, R2(d.balance || 0)), 0);
}

/** Crédit total (trop-perçus + paiements non affectés). */
export function totalCredit(dues: any[], payments: any[]): number {
  const overpaid = (dues || []).reduce((s, d) => s + Math.max(0, R2(-(d.balance || 0))), 0);
  const unalloc = (payments || []).reduce((s, p) => s + R2(p.unallocated || 0), 0);
  return R2(overpaid + unalloc);
}