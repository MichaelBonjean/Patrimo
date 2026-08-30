import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

// manageSupport : create / list / reply — historique des demandes support
// (RGPD-aware, isolé par owner_id via RLS). Pas d'envoi d'email "sec":
// le ticket est persisté et confirme par email (best-effort).

const SUPPORT_INBOX = process.env.EMAIL_FROM || "";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    let body: any = {};
    try { body = await req.json(); } catch (_) {}
    const action = body.action;

    if (action === "create") {
      const me = await base44.auth.me();
      if (!me || !me.email) return Response.json({ error: "Authentification requise" }, { status: 401 });
      const subject = (body.subject || "").toString().trim();
      const message = (body.message || "").toString().trim();
      const category = ["aide", "contact", "bug"].includes(body.category) ? body.category : "contact";
      if (!subject) return Response.json({ error: "Sujet requis" }, { status: 400 });
      if (!message) return Response.json({ error: "Message requis" }, { status: 400 });

      const now = new Date().toISOString();
      const ticket = await base44.entities.SupportTicket.create({
        owner_id: me.email,
        email: me.email,
        subject,
        category,
        status: "open",
        priority: category === "bug" ? "urgent" : "normal",
        page_url: (body.page_url || "").toString().slice(0, 500),
        user_agent: (body.user_agent || "").toString().slice(0, 500),
        stack_trace: (body.stack_trace || "").toString().slice(0, 4000),
        messages: [{ from: "user", body: message, date: now, actor_email: me.email }],
        last_reply_date: now,
      });

      // Confirmation par email (best-effort, ne bloque pas)
      try {
        await base44.integrations.Core.SendEmail({
          to: me.email,
          subject: `[Patrimo Support] ${subject}`,
          body: `Bonjour,\n\nNous avons bien reçu votre demande (#${ticket.id}).\nNotre équipe vous répondra par email dans les meilleurs délais.\n\nSujet : ${subject}\n\nCet email est automatique, merci de ne pas y répondre.`,
        });
      } catch (_) {}

      if (SUPPORT_INBOX) {
        try {
          await base44.integrations.Core.SendEmail({
            to: SUPPORT_INBOX,
            subject: `[Patrimo] Nouveau ticket ${category} — ${subject}`,
            body: `Nouveau ticket support.\n\nAuteur : ${me.email}\nCatégorie : ${category}\nSujet : ${subject}\n\nMessage :\n${message}\n\nPage : ${body.page_url || ""}\nStack : ${body.stack_trace || ""}`,
          });
        } catch (_) {}
      }

      return Response.json({ ok: true, id: ticket.id });
    }

    if (action === "list") {
      const me = await base44.auth.me();
      if (!me || !me.email) return Response.json({ error: "Authentification requise" }, { status: 401 });
      const tickets = await base44.entities.SupportTicket.list("-updated_date", 50);
      return Response.json({ ok: true, tickets });
    }

    if (action === "reply") {
      const me = await base44.auth.me();
      if (!me || !me.email) return Response.json({ error: "Authentification requise" }, { status: 401 });
      const id = (body.ticket_id || "").toString();
      const text = (body.body || "").toString().trim();
      if (!id || !text) return Response.json({ error: "ticket_id et body requis" }, { status: 400 });
      const ticket = await base44.entities.SupportTicket.get(id);
      if (!ticket) return Response.json({ error: "Ticket introuvable" }, { status: 404 });
      const now = new Date().toISOString();
      const msgs = Array.isArray(ticket.messages) ? ticket.messages : [];
      msgs.push({ from: "support", body: text, date: now, actor_email: me.email });
      await base44.entities.SupportTicket.update(id, {
        messages: msgs,
        last_reply_date: now,
        status: "answered",
      });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "action inconnue (create|list|reply)" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}