import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { buildCalendarEvents } from '../../shared/calendarEngine.ts';

// Cache mémoire best-effort (par utilisateur, TTL 60s).
// En environnement serverless le cache est par isolat : c'est un cache "au mieux",
// invalidé naturellement à la TTL. Les mutations invalideront l'isolat à la
// prochaine requête (le cache reste borné à 60s).
const TTL_MS = 60_000;
const cache = new Map<string, { ts: number; payload: any }>();

function iso(d: Date) { return d.toISOString().slice(0, 10); }

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let body: any = {};
    try { body = await req.json(); } catch (_) { /* requête sans corps = valeurs par défaut */ }
    const now = new Date();
    const today = iso(now);
    const from = body.from || iso(new Date(now.getTime() - 365 * 86400000));
    const to = body.to || iso(new Date(now.getTime() + 90 * 86400000));
    const propertyIds = Array.isArray(body.propertyIds) ? body.propertyIds : undefined;
    const types = Array.isArray(body.types) ? body.types : undefined;
    const includeSnoozed = body.includeSnoozed !== false;
    const includeInformational = body.includeInformational !== false;
    const includeResolved = body.includeResolved === true;

    const cacheKey = JSON.stringify({ from, to, propertyIds, types, includeSnoozed, includeInformational, includeResolved, email: user.email });
    const hit = cache.get(user.email + cacheKey);
    if (hit && Date.now() - hit.ts < TTL_MS) {
      return Response.json({ events: hit.payload });
    }

    // Fetch user-scoped (RLS isole par owner_id).
    const [properties, lots, leases, rentDues, impayes, quittances, rentRevisions, chargeRegs, monthCloses, documents, transactions, alerts] =
      await Promise.all([
        base44.entities.Property.filter({}),
        base44.entities.Lot.filter({}),
        base44.entities.Lease.filter({}),
        base44.entities.RentDue.filter({}),
        base44.entities.Impaye.filter({}),
        base44.entities.Quittance.filter({}),
        base44.entities.RentRevision.filter({}),
        base44.entities.ChargeRegularization.filter({}),
        base44.entities.MonthClose.filter({}),
        base44.entities.Document.filter({}),
        base44.entities.Transaction.filter({}),
        base44.entities.Alert.filter({}),
      ]);

    const events = buildCalendarEvents(
      { properties, lots, leases, rentDues, impayes, quittances, rentRevisions, chargeRegs, monthCloses, documents, transactions, alerts },
      { from, to, now: today, propertyIds, types, includeSnoozed, includeInformational, includeResolved }
    );

    cache.set(user.email + cacheKey, { ts: Date.now(), payload: events });
    if (cache.size > 50) for (const k of cache.keys()) if (Date.now() - cache.get(k)!.ts > TTL_MS) cache.delete(k);

    return Response.json({ events });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}