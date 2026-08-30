import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

// Purge des comptes en attente depuis plus de 30 jours (RGPD art. 17).
// Invoquée par le workflow planifié quotidien en service role.
// Supprime toutes les entités propriétées par l'utilisateur, conserve l'audit
// (traçabilité), puis marque le compte comme purgé.

// Entités à purger (filtrées par owner_id = patrimony_id ou email).
const PURGE_ENTITIES = [
  "Property", "Lot", "Lease", "RentDue", "Payment", "Transaction",
  "BankTransaction", "BankImport", "Impaye", "Quittance", "Document",
  "Alert", "RentRevision", "ChargeRegularization", "MonthClose",
  "Holder", "HolderMember", "PropertyHolder", "TenantAccess", "Incident",
  "EmailLog", "UserMilestone", "Subscription", "InvestmentScenario", "PatrimonyMember",
];

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const users = await svc.entities.User.list("-created_date", 500);
    const now = Date.now();
    const purged: string[] = [];

    for (const u of (users || [])) {
      const pd = (u as any).pending_deletion;
      if (!pd || pd.status !== "pending" || !pd.scheduled_at) continue;
      if (new Date(pd.scheduled_at).getTime() > now) continue;

      const email = u.email;
      const ownerId = (u as any).patrimony_id || email;

      for (const e of PURGE_ENTITIES) {
        const ent = (svc.entities as any)[e];
        if (!ent || typeof ent.deleteMany !== "function") continue;
        try { await ent.deleteMany({ owner_id: ownerId }); } catch (_) {}
        if (ownerId !== email) { try { await ent.deleteMany({ owner_id: email }); } catch (_) {} }
      }
      try { await svc.entities.Subscription.deleteMany({ user_id: u.id }); } catch (_) {}

      try {
        await svc.entities.AuditLog.create({
          patrimony_id: ownerId,
          actor_email: "system@patrimo",
          action: "delete",
          entity_type: "User",
          entity_id: u.id,
          entity_label: email,
          details: { type: "account_purged", scheduled_at: pd.scheduled_at },
          date: new Date().toISOString(),
        });
      } catch (_) {}

      try {
        await svc.entities.User.update(u.id, {
          pending_deletion: { status: "purged", purged_at: new Date().toISOString() },
        });
      } catch (_) {}

      purged.push(u.id);
    }

    return Response.json({ ok: true, purged, count: purged.length });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}