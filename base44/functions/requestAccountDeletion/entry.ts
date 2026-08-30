import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

// Déclenche une demande de suppression de compte (RGPD art. 17).
// - marque l'utilisateur pending_deletion (délai 30j)
// - envoie un email de confirmation avec un lien de désactivation
// - crée une entrée d'audit
// Invoqué par l'utilisateur authentifié. Écrit en service role (bypass RLS)
// pour mettre à jour son propre User + EmailLog/AuditLog.

const DAY_MS = 86400000;
const RETENTION_DAYS = 30;

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me || !me.email) return Response.json({ error: "Authentification requise" }, { status: 401 });

    const email = me.email;
    const userId = me.id;
    const patrimonyId = (me as any).patrimony_id || email;

    if ((me as any).pending_deletion && (me as any).pending_deletion.status === "pending") {
      return Response.json({ error: "Une suppression est déjà en cours" }, { status: 400 });
    }

    const token = crypto.randomUUID();
    const now = new Date();
    const scheduledAt = new Date(now.getTime() + RETENTION_DAYS * DAY_MS).toISOString();
    const pending = {
      status: "pending",
      requested_at: now.toISOString(),
      scheduled_at: scheduledAt,
      cancel_token: token,
    };

    await base44.asServiceRole.entities.User.update(userId, { pending_deletion: pending });

    const origin = new URL(req.url).origin;
    const cancelUrl = `${origin}/cancel-deletion?token=${token}`;
    const dateFr = new Date(scheduledAt).toLocaleDateString("fr-FR");

    try {
      await base44.integrations.Core.SendEmail({
        to: email,
        subject: "Confirmation de la suppression de votre compte Patrimo",
        body: `Bonjour,

Nous avons bien enregistré votre demande de suppression de votre compte Patrimo.

Conformément au RGPD, vos données seront définitivement purgées dans 30 jours, soit le ${dateFr}.

Vous pouvez annuler cette demande à tout moment avant cette échéance en cliquant sur le lien suivant :
${cancelUrl}

Si vous n'êtes pas à l'origine de cette demande, utilisez ce lien pour désactiver la procédure.

Cet email est automatique, merci de ne pas y répondre.`,
      });
    } catch (e) {
      // l'email peut échouer hors domaine connecté ; on ne bloque pas la demande
    }

    try {
      await base44.asServiceRole.entities.EmailLog.create({
        owner_id: email,
        to: email,
        subject: "Confirmation de suppression de compte",
        template: "custom",
        status: "sent",
        provider: "base44",
        related_entity_type: "account_deletion",
        related_entity_id: userId,
      });
    } catch (_) {}

    try {
      await base44.asServiceRole.entities.AuditLog.create({
        patrimony_id: patrimonyId,
        actor_email: email,
        action: "delete",
        entity_type: "User",
        entity_id: userId,
        entity_label: email,
        details: { type: "account_deletion_requested", scheduled_at: scheduledAt },
        date: now.toISOString(),
      });
    } catch (_) {}

    return Response.json({ ok: true, scheduled_at: scheduledAt });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}