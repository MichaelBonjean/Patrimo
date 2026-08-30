/**
 * Contexte de rapprochement partagé : charge et prépare les données owner-filtered
 * (leases, rent_dues ouvertes, rules, bank_accounts, holders, properties, loans
 * synthétiques) et expose des helpers de matching compte → BankTransaction.
 * Partagé par `reconcileBankTransactions` (batch) et `applyReconciliation`
 * (validation unitaire) — aucune duplication de logique de contexte.
 */

export function findAccountForBt(accounts: any[], bt: any): any | null {
  if (!bt) return null;
  return (accounts || []).find((a: any) =>
    (a.account_masked_id && bt.account_id && String(a.account_masked_id) === String(bt.account_id)) ||
    (a.id && bt.bank_account_id && String(a.id) === String(bt.bank_account_id))
  ) || null;
}

/** Échéances ouvertes (unpaid / partial, solde > 0). */
export function filterOpenDues(rentDuesAll: any[]): any[] {
  return (rentDuesAll || []).filter(
    (rd: any) => rd && (rd.status === 'unpaid' || rd.status === 'partial') && (Number(rd.balance) || Number(rd.total_due) || 0) > 0.01
  );
}

/** Prêts synthétiques (convention loan:<property_id>) construits depuis les Property. */
export function buildLoansFromProperties(properties: any[]): any[] {
  return (properties || [])
    .filter((p: any) => p && (Number(p.monthly_payment) > 0 || Number(p.loan_amount) > 0))
    .map((p: any) => ({
      id: `loan:${p.id}`,
      property_id: p.id,
      holder_id: undefined,
      loan_amount: Number(p.loan_amount) || 0,
      rate: Number(p.loan_rate) || 0,
      loan_rate: Number(p.loan_rate) || 0,
      duration_years: Number(p.loan_duration_years) || 0,
      loan_duration_years: Number(p.loan_duration_years) || 0,
      monthly_payment: Number(p.monthly_payment) || 0,
      insurance: Number(p.monthly_insurance) || 0,
      monthly_insurance: Number(p.monthly_insurance) || 0,
    }));
}

/**
 * Charge tout le contexte d'analyse pour un propriétaire.
 * `svc` = base44.asServiceRole (accès lecture owner-filtered via owner_id).
 */
export async function loadReconcileContext(svc: any, ownerEmail: string): Promise<any> {
  const ownerFilter = { owner_id: ownerEmail };
  const [leases, rentDuesAll, rules, accounts, holders, properties] = await Promise.all([
    svc.entities.Lease.filter(ownerFilter).catch(() => []),
    svc.entities.RentDue.filter(ownerFilter).catch(() => []),
    svc.entities.BankRule.filter(ownerFilter).catch(() => []),
    svc.entities.BankAccount.filter(ownerFilter).catch(() => []),
    svc.entities.Holder.filter(ownerFilter).catch(() => []),
    svc.entities.Property.filter(ownerFilter).catch(() => []),
  ]);
  return {
    leases: leases || [],
    rent_dues: filterOpenDues(rentDuesAll),
    rules: rules || [],
    accounts: accounts || [],
    holders: holders || [],
    properties: properties || [],
    loans: buildLoansFromProperties(properties),
  };
}