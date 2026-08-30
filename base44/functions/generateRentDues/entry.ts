import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { isLeaseActiveAt, todayISO } from '../../shared/leaseResolve.ts';
import { generateRentDuesForLease } from '../../shared/rentDueEngine.ts';

/**
 * Génère (ou régénère de façon idempotente) les échéances mensuelles (RentDue)
 * des baux actifs. Réservé au rôle admin ou au planificateur système (sans user).
 *
 * Paramètres optionnels :
 *  - lease_id : limiter à un bail (admin manuel)
 *  - backfill_months : générer N mois dans le passé depuis ce mois-ci (déf. 0)
 *  - forward_months : générer N mois dans le futur (déf. 1)
 *  - backfill_from_start : régénérer depuis le date_start du bail (bool)
 *
 * La logique par bail vit dans base44/shared/rentDueEngine.ts (réutilisée par
 * le commit d'import documentaire après création/mise à jour d'un bail).
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: reserved to scheduled system or admin' }, { status: 403 });
    }
    const svc = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch (_e) { /* payload vide = valeurs par défaut */ }

    const backfillFromStart = !!body.backfill_from_start;
    const backfill = Math.max(0, Math.min(24, Number(body.backfill_months) || 0));
    const forward = Math.max(0, Math.min(12, Number(body.forward_months) ?? 1));
    const leaseId = body.lease_id ? String(body.lease_id) : null;

    let leases: any[];
    if (leaseId) {
      leases = await svc.entities.Lease.filter({ id: leaseId });
    } else {
      leases = await svc.entities.Lease.list(500);
    }

    const today = todayISO();
    const active = (leases || []).filter((l) => l.owner_id && isLeaseActiveAt(l, today));

    let created = 0;
    let skipped = 0;
    for (const lease of leases || []) {
      const res = await generateRentDuesForLease(svc, lease, {
        today,
        forward_months: forward,
        backfill_months: backfill,
        backfill_from_start: backfillFromStart,
      });
      created += res.created;
      skipped += res.skipped;
    }

    return Response.json({ ok: true, active_leases: active.length, created, skipped });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}