/**
 * Moteur de détection/suivi des impayés — basé exclusivement sur le compte
 * locataire (RentDue → balance) plutôt que sur le loyer théorique.
 *
 * Principes :
 *  - Un impayé existe si, et seulement si, une échéance (RentDue) arrivée à
 *    maturité (due_date <= aujourd'hui) présente un solde débiteur (balance > 0).
 *  - balance = total_due - paid_amount (CAF + locataire + garant + assurance …
 *    tous confondus via les Payment.allocation).
 *  - 1 Impayé par échéance (clé naturelle = rent_due_id). Idempotent.
 *  - Chaque paiement/détection met à jour outstanding_amount ; quand la
 *    balance atteint 0, l'impayé passe à "régularisé".
 *  - Aucune création si l'échéance n'est pas échue ou si elle est soldée.
 */

import { R2 } from './rentLedger.ts';

export const IMPAYE_STATUSES = ['echeance_impayee', 'rappel_amiable', 'deuxieme_relance', 'mise_en_demeure_amiable', 'dossier_professionnel', 'régularisé', 'abandonné'] as const;

/** Jours de retard écoulés entre la date d'échéance et une date de référence. */
export function lateDays(due_date: string, asOfISO: string): number {
  if (!due_date || !asOfISO) return 0;
  const d = new Date(due_date + 'T00:00:00Z').getTime();
  const a = new Date(asOfISO + 'T00:00:00Z').getTime();
  if (!isFinite(d) || !isFinite(a)) return 0;
  return Math.max(0, Math.floor((a - d) / 86400000));
}

function lastRelanceDate(relance_history: any[]): string | null {
  if (!Array.isArray(relance_history) || !relance_history.length) return null;
  const dates = relance_history.map((r) => r && r.date).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

interface Snap {
  tenant_email: string;
  tenant_address: string;
  property_name: string;
  lot_designation: string;
}

function buildSnap(property: any, lot: any, lease: any): Snap {
  const tenant = (lease?.tenants || [])[0] || {};
  const addr = property
    ? [property.address, property.postal_code, property.city].filter(Boolean).join(' ')
    : '';
  return {
    tenant_email: tenant.email || lease?.tenant_email || lot?.tenant_email || '',
    tenant_address: addr,
    property_name: property?.name || '',
    lot_designation: lot?.designation || '',
  };
}

interface SyncResult {
  created: number;
  updated: number;
  regularized: number;
}

/**
 * Applique la synchronisation sur une liste d'échéances + la liste des
 * Impayes déjà existants. Ne touche QUE les échéances passées en paramètre
 * (le cron passe tout ; recordPayment passe un bail précis).
 */
async function applySync(
  svc: any,
  dues: any[],
  existingImpayes: any[],
  asOfISO: string,
  resolveSnap: (due: any) => Snap,
): Promise<SyncResult> {
  const byRentDue = new Map<string, any>();
  for (const i of existingImpayes) {
    if (i.rent_due_id) byRentDue.set(i.rent_due_id, i);
  }

  let created = 0;
  let updated = 0;
  let regularized = 0;

  for (const due of dues) {
    const totalDue = R2(Number(due.total_due) || 0);
    const paid = R2(Number(due.paid_amount) || 0);
    const balance = R2(totalDue - paid);
    const isMature = !!due.due_date && due.due_date <= asOfISO;
    const existing = byRentDue.get(due.id);
    const snap = resolveSnap(due);
    const late = lateDays(due.due_date, asOfISO);

    const isDebtor = balance > 0.01; // solde débiteur strict

    if (isMature && isDebtor) {
      // Impayé actif
      if (existing) {
        const patch: any = {
          paid_amount: paid,
          missing_amount: balance,
          outstanding_amount: balance,
          late_days: late,
        };
        // Une dette qui réapparaît après régularisation (paiement retiré):
        // on repasse en "détecté" sans effacer l'historique de relances.
        if (existing.status === 'régularisé') {
          patch.status = 'echeance_impayee';
          patch.regularized_date = null;
        }
        await svc.entities.Impaye.update(existing.id, patch);
        updated++;
      } else {
        await svc.entities.Impaye.create({
          owner_id: due.owner_id,
          is_demo: !!due.is_demo,
          rent_due_id: due.id,
          lease_id: due.lease_id,
          lot_id: due.lot_id,
          property_id: due.property_id,
          tenant_name: due.tenant_name || '',
          tenant_email: snap.tenant_email,
          tenant_address: snap.tenant_address,
          property_name: snap.property_name,
          lot_designation: snap.lot_designation,
          expected_amount: totalDue,
          initial_amount: totalDue,
          paid_amount: paid,
          missing_amount: balance,
          outstanding_amount: balance,
          year: due.year,
          month: due.month,
          period: due.period,
          due_date: due.due_date,
          detected_date: asOfISO,
          first_unpaid_date: due.due_date,
          late_days: late,
          last_relance_date: null,
          status: 'echeance_impayee',
          regularized_date: null,
          relance_history: [],
        });
        created++;
      }
    } else if (existing && existing.status !== 'régularisé') {
      // La balance est <= 0 (soldée ou trop-perçu) OU l'échéance est devenue
      // non échue (cas tordu): on ne régularise que si réellement soldée.
      if (balance <= 0.01 && isMature) {
        await svc.entities.Impaye.update(existing.id, {
          paid_amount: paid,
          missing_amount: 0,
          outstanding_amount: 0,
          late_days: late,
          status: 'régularisé',
          regularized_date: asOfISO,
        });
        regularized++;
      } else {
        // Non échue mais impayé déjà existant (ne devrait pas arriver) :
        // on laisse en l'état, sans le régulariser.
        updated += 0;
      }
    }
  }

  return { created, updated, regularized };
}

/** Synchronise les impayés d'un bail (utilisé par recordPayment). */
export async function syncImpayesForLease(
  svc: any,
  lease_id: string,
  asOfISO: string = new Date().toISOString().slice(0, 10),
): Promise<SyncResult> {
  const dues: any[] = await svc.entities.RentDue.filter({ lease_id });
  if (!dues.length) {
    // Aucune échéance : on régularise quand même les anciens impayés du bail.
    const stale: any[] = await svc.entities.Impaye.filter({ lease_id });
    let regularized = 0;
    for (const i of stale) {
      if (i.status !== 'régularisé') {
        await svc.entities.Impaye.update(i.id, {
          missing_amount: 0,
          outstanding_amount: 0,
          status: 'régularisé',
          regularized_date: asOfISO,
        });
        regularized++;
      }
    }
    return { created: 0, updated: 0, regularized };
  }

  const lease = await svc.entities.Lease.get(lease_id).catch(() => null);
  const lot = dues[0]?.lot_id ? await svc.entities.Lot.get(dues[0].lot_id).catch(() => null) : null;
  const property = dues[0]?.property_id ? await svc.entities.Property.get(dues[0].property_id).catch(() => null) : null;
  const existing: any[] = await svc.entities.Impaye.filter({ lease_id });

  return applySync(svc, dues, existing, asOfISO, () => buildSnap(property, lot, lease));
}

/** Synchronise les impayés de tout le portefeuille (utilisé par le cron). */
export async function syncImpayesAll(
  svc: any,
  asOfISO: string = new Date().toISOString().slice(0, 10),
  owner_filter?: string,
): Promise<SyncResult> {
  const dues: any[] = await svc.entities.RentDue.filter(owner_filter ? { owner_id: owner_filter } : {});
  const existing: any[] = await svc.entities.Impaye.filter(owner_filter ? { owner_id: owner_filter } : {});

  const propIds = new Set(dues.map((d) => d.property_id).filter(Boolean));
  const lotIds = new Set(dues.map((d) => d.lot_id).filter(Boolean));
  const leaseIds = new Set(dues.map((d) => d.lease_id).filter(Boolean));

  const properties = new Map<string, any>();
  const lots = new Map<string, any>();
  const leases = new Map<string, any>();
  for (const id of propIds) {
    const p = await svc.entities.Property.get(id).catch(() => null);
    if (p) properties.set(id, p);
  }
  for (const id of lotIds) {
    const l = await svc.entities.Lot.get(id).catch(() => null);
    if (l) lots.set(id, l);
  }
  for (const id of leaseIds) {
    const l = await svc.entities.Lease.get(id).catch(() => null);
    if (l) leases.set(id, l);
  }

  return applySync(svc, dues, existing, asOfISO, (due) =>
    buildSnap(properties.get(due.property_id), lots.get(due.lot_id), leases.get(due.lease_id)),
  );
}