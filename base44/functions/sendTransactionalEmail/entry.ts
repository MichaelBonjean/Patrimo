import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { renderEmailTemplate, EMAIL_TEMPLATE_KEYS } from '../../shared/emailTemplates.ts';
import { sendEmailWithRetry } from '../../shared/emailService.ts';

/**
 * Point d'entrée HTTP — envoi d'un email transactionnel à n'importe quelle
 * adresse valide (locataire sans compte inclus), via EmailService multi-fournisseurs.
 *
 * Les secrets (clés API) restent côté serveur. Le rendu HTML des templates se
 * fait côté serveur (aucun HTML arbitraire du client) — le frontend ne fournit
 * que les variables + les URLs des pièces jointes.
 *
 * Payload:
 *   { to, template, variables, attachments?: [{url, filename}],
 *     related_entity_type?, related_entity_id? }
 *
 * Réponse: { ok, status: queued|sent|failed, provider, message_id?, log_id?, attempts, error? }
 *
 * En cas d'échec définitif, ne lève pas — renvoie ok:false + status:"failed" afin
 * que l'UI ne reste jamais bloquée en état "sending".
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' && user.role !== 'user') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: any = {};
    try { body = await req.json(); } catch (_e) {
      return Response.json({ error: 'Corps de requête invalide' }, { status: 400 });
    }

    const to = String(body.to || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return Response.json({ error: 'Adresse destinataire invalide' }, { status: 400 });
    }
    const template = String(body.template || '');
    if (!EMAIL_TEMPLATE_KEYS.includes(template as any)) {
      return Response.json({ error: 'template inconnu' }, { status: 400 });
    }
    const variables = (body.variables && typeof body.variables === 'object') ? body.variables : {};
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.filter((a: any) => a && a.url).map((a: any) => ({
          url: String(a.url), filename: String(a.filename || 'document'),
        }))
      : [];

    const tpl = renderEmailTemplate(template, variables);

    const res = await sendEmailWithRetry(base44.asServiceRole, {
      to, subject: tpl.subject, html: tpl.html, text: tpl.text,
      attachments, template, variables,
      owner_id: user.email,
      is_demo: !!body.is_demo,
      related_entity_type: body.related_entity_type ? String(body.related_entity_type) : undefined,
      related_entity_id: body.related_entity_id ? String(body.related_entity_id) : undefined,
    });

    return Response.json({
      ok: res.status !== 'failed',
      status: res.status,
      provider: res.provider,
      message_id: res.message_id,
      log_id: res.log_id,
      attempts: res.attempts,
      error: res.error,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}