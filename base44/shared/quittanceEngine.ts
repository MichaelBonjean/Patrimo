import { R2 } from './rentLedger.ts';
import { legalMentionFor } from './quittanceTexts.ts';

/**
 * Moteur de génération d'une quittance/reçu immuable à partir du compte
 * locataire réel (RentDue -> Payments). Partagé entre le point d'entrée HTTP
 * (generateQuittance) et les tests (testQuittances) — évite une récursion de
 * worker (un fonction invoquant une autre fonction).
 *
 * Règles :
 *  - paid = 0            -> { ok:false, reason:'unpaid', status? }
 *  - 0 < paid < total_dû -> kind='partial'
 *  - paid >= total_dû     -> kind='full'
 *
 * @param svc base44.asServiceRole
 * @param user utilisateur authentifié (fournit owner_id + nom)
 * @returns objet { ok, kind, reason?, quittance } — ok=false si impossible
 */
export async function generateQuittanceFor(
  svc: any,
  user: { email: string; full_name?: string },
  args: { lease_id: string; year: number; month: number }
): Promise<any> {
  const { lease_id, year, month } = args;
  if (!lease_id) return { ok: false, status: 400, body: { error: 'lease_id requis' } };
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, status: 400, body: { error: 'year / month invalides' } };
  }

  let lease: any;
  try { lease = await svc.entities.Lease.get(lease_id); } catch (_e) {
    return { ok: false, status: 404, body: { error: 'Bail introuvable' } };
  }
  if (!lease || lease.owner_id !== user.email) {
    return { ok: false, status: 404, body: { error: 'Bail introuvable' } };
  }

  const dues: any[] = await svc.entities.RentDue.filter({ lease_id: lease.id, year, month });
  const due = dues[0];
  if (!due) {
    return { ok: false, status: 404, body: { reason: 'no_due', error: "Aucune échéance n'existe pour cette période" } };
  }

  const allPayments: any[] = await svc.entities.Payment.filter({ lease_id: lease.id });
  const allocated = allPayments
    .filter((p) => (p.allocations || []).some((a) => a.rent_due_id === due.id))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  let paid_amount = 0;
  for (const p of allocated) {
    for (const a of p.allocations || []) {
      if (a.rent_due_id === due.id) paid_amount = R2(paid_amount + Number(a.amount) || 0);
    }
  }
  const total_due = R2(Number(due.total_due) || 0);
  const balance = R2(total_due - paid_amount);

  let kind = 'full';
  if (paid_amount <= 0) {
    return { ok: false, status: 409, body: { reason: 'unpaid', error: 'Aucun paiement enregistré pour cette période' } };
  }
  if (paid_amount < total_due) kind = 'partial';

  const last = allocated[allocated.length - 1] || null;
  const payment_date = last ? String(last.date || '').slice(0, 10) : '';
  const payment_method = last && last.method ? String(last.method) : '';

  // Idempotence (lease_id + période)
  let existing: any = null;
  const byLease: any[] = await svc.entities.Quittance.filter({ lease_id: lease.id, year, month });
  existing = byLease[0];
  if (!existing && lease.lot_id) {
    const byLot: any[] = await svc.entities.Quittance.filter({ lot_id: lease.lot_id, year, month });
    existing = byLot[0] || null;
  }
  if (existing) {
    return { ok: true, kind: existing.kind || 'full', reason: 'exists', quittance: existing };
  }

  let property: any = {};
  try { property = await svc.entities.Property.get(lease.property_id) || {}; } catch (_e) {}
  let lot: any = {};
  try { lot = await svc.entities.Lot.get(lease.lot_id) || {}; } catch (_e) {}

  const landlordName = user.full_name || property.landlord_email || 'Bailleur';
  const fullAddr = `${property.address || ''}${property.postal_code ? ' ' + property.postal_code : ''}${property.city ? ' ' + property.city : ''}`.trim();
  const landlordAddress = property.landlord_address || fullAddr;
  const tenantName = (lease.tenants || []).map((t: any) => t.name).filter(Boolean).join(', ') || '—';
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const receipt_number = `Q-${period}-${(lot.code || lease.lot_id || lease.id).slice(0, 6).toUpperCase()}`;
  const issue_date = new Date().toISOString().slice(0, 10);
  const rent_hc = Number(due.rent_excluding_charges) || 0;
  const charges = Number(due.charges) || 0;
  const additional_amount = Number(due.additional_amount) || 0;
  const legal_note = legalMentionFor(kind);

  const record: any = {
    owner_id: lease.owner_id,
    is_demo: !!lease.is_demo,
    lease_id: lease.id,
    rent_due_id: due.id,
    lot_id: lease.lot_id || '',
    property_id: lease.property_id || '',
    year, month, period, kind,
    rent_hc, charges, additional_amount, assurance: additional_amount,
    total_due, paid_amount, balance,
    total: paid_amount,
    landlord_name: landlordName, landlord_address: landlordAddress,
    tenant_name: tenantName, tenant_address: fullAddr,
    property_name: property.name || '—',
    lot_designation: lot.designation || lot.code || 'Lot',
    lot_address: fullAddr,
    receipt_number,
    payment_method, payment_date, legal_note,
    issue_date,
    status: 'generated', sent_by_email: false,
  };

  const created = await svc.entities.Quittance.create(record);
  return { ok: true, kind, reason: 'created', quittance: created };
}