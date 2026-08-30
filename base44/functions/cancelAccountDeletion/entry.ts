import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

// Annule une procédure de suppression de compte à partir du jeton contenu
// dans le lien de désactivation envoyé par email. Endpoint public (sans auth
// utilisateur) : on retrouve le compte par le jeton via le service role.

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    let token = "";
    try {
      const body = await req.json();
      token = (body && body.token) || "";
    } catch (_) {
      token = "";
    }
    if (!token) token = new URL(req.url).searchParams.get("token") || "";
    if (!token) return Response.json({ error: "Jeton manquant" }, { status: 400 });

    const users = await svc.entities.User.list("-created_date", 500);
    const user = (users || []).find((u: any) =>
      u.pending_deletion && u.pending_deletion.cancel_token === token && u.pending_deletion.status === "pending"
    );
    if (!user) return Response.json({ error: "Demande introuvable ou déjà traitée" }, { status: 404 });

    await svc.entities.User.update(user.id, {
      pending_deletion: { status: "canceled", canceled_at: new Date().toISOString(), cancel_token: token },
    });

    try {
      await svc.entities.EmailLog.create({
        owner_id: user.email,
        to: user.email,
        subject: "Suppression de compte annulée",
        template: "custom",
        status: "sent",
        provider: "base44",
        related_entity_type: "account_deletion",
        related_entity_id: user.id,
      });
    } catch (_) {}

    try {
      await svc.entities.AuditLog.create({
        patrimony_id: user.patrimony_id || user.email,
        actor_email: user.email,
        action: "delete",
        entity_type: "User",
        entity_id: user.id,
        entity_label: user.email,
        details: { type: "account_deletion_canceled" },
        date: new Date().toISOString(),
      });
    } catch (_) {}

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}