/**
 * Moteur partagé de génération des échéances de loyer (RentDue).
 *
 * Facteur commun entre :
 *  - la fonction planifiée `generateRentDues` (régénération périodique de tous
 *    les baux actifs) ;
 *  - le `commitDocumentImport` qui, après création/mise à jour d'un bail issu
 *    d'un document importé (bail ALUR…), génère les échéances futures.
 *
 * Règles (identiques à l'implémentation historique) :
 *  - une échéance n'est créée que pour les mois où le bail est actif
 *    (date_start <= 1er du mois, et date_end >= 1er du mois si présente) ;
 *  - idempotente : aucune échéance dupliquée (clé period YYYY-MM par bail) ;
 *  - total > 0 requis (loyer HC + charges).
 */

import { isLeaseActiveAt } from './leaseResolve.ts';
import { monthKey, addMonths, dueDateFor, R2 } from './rentLedger.ts';

export interface RentDueGenResult {
  created: number;
  skipped: number;
  active: boolean;
}

/**
 * Génère (idempotente) les échéances d'UN bail sur une fenêtre passée/future.
 *
 * @param svc          client service-role Base44
 * @param lease        enregistrement Lease (doit posséder owner_id)
 * @param opts.today   date ISO de référence (défaut : aujourd'hui)
 * @param opts.forward_months   N mois dans le futur (défaut 1)
 * @param opts.backfill_months   N mois dans le passé depuis ce mois-ci (défaut 0)
 * @param opts.backfill_from_start  régénérer depuis date_start du bail (défaut false)
 */
export async function generateRentDuesForLease(
  svc: any,
  lease: any,
  opts: { today?: string; forward_months?: number; backfill_months?: number; backfill_from_start?: boolean } = {}
): Promise<RentDueGenResult> {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  if (!lease || !lease.owner_id || !isLeaseActiveAt(lease, today)) {
    return { created: 0, skipped: 0, active: false };
  }

  const backfillFromStart = !!opts.backfill_from_start;
  const backfill = Math.max(0, Math.min(24, Number(opts.backfill_months) || 0));
  const forward = Math.max(0, Math.min(12, Number(opts.forward_months) ?? 1));

  const now = new Date(today + 'T00:00:00');
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;

  const dueDay = Number(lease.due_day) || 5;
  let start = { year: curY, month: curM };
  if (backfillFromStart && lease.date_start) {
    const [sy, sm] = String(lease.date_start).split('-').map(Number);
    start = { year: sy, month: sm };
  } else if (backfill > 0) {
    start = addMonths(curY, curM, -backfill);
  }
  const rangeEnd = addMonths(curY, curM, forward);

  const existing: any[] = await svc.entities.RentDue.filter({ lease_id: lease.id });
  const seen = new Set((existing || []).map((d) => d.period));

  const tenant = (lease.tenants || [])[0] || null;
  const hc = R2(Number(lease.rent_excluding_charges) || 0);
  const charges = R2(Number(lease.charges) || 0);
  const total = R2(hc + charges);

  let created = 0;
  let skipped = 0;
  let { year, month } = start;
  let guard = 0;
  while (guard++ < 600) {
    const firstISO = `${year}-${String(month).padStart(2, '0')}-01`;
    if (lease.date_start && firstISO < String(lease.date_start)) {
      const nx = addMonths(year, month, 1);
      year = nx.year; month = nx.month;
      if (year > rangeEnd.year || (year === rangeEnd.year && month > rangeEnd.month)) break;
      continue;
    }
    if (lease.date_end && String(lease.date_end) < firstISO) break;

    const key = monthKey(year, month);
    if (total > 0 && !seen.has(key)) {
      await svc.entities.RentDue.create({
        owner_id: lease.owner_id,
        is_demo: !!lease.is_demo,
        lease_id: lease.id,
        property_id: lease.property_id,
        lot_id: lease.lot_id,
        year, month, period: key,
        due_date: dueDateFor(year, month, dueDay),
        rent_excluding_charges: hc,
        charges,
        additional_amount: 0,
        total_due: total,
        paid_amount: 0,
        balance: total,
        status: 'unpaid',
        tenant_name: tenant?.name || lease.tenant_name || '',
        generated_date: today,
      });
      created++;
      seen.add(key);
    } else {
      skipped++;
    }

    if (year === rangeEnd.year && month === rangeEnd.month) break;
    const nx = addMonths(year, month, 1);
    year = nx.year; month = nx.month;
  }

  return { created, skipped, active: true };
}