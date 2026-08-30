import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateAndRenewAccess } from '../../shared/tenantPortal.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const token = body.token;
    const message = (body.message || '').toString().trim();
    if (!token) return Response.json({ ok: false, code: 'not_found' }, { status: 404 });
    if (!message) return Response.json({ ok: false, error: 'Message vide' }, { status: 400 });

    const ctx = await validateAndRenewAccess(svc, token, { req });
    if (!ctx.ok) {
      const status = ctx.code === 'rate_limited' ? 429 : 403;
      return Response.json({ ok: false, code: ctx.code }, { status });
    }
    const { access, property } = ctx;

    const landlordEmail = property?.landlord_email;
    if (!landlordEmail) {
      return Response.json({ ok: false, error: "Le bailleur n'a pas configuré d'adresse de contact." }, { status: 400 });
    }

    await svc.integrations.Core.SendEmail({
      to: landlordEmail,
      subject: `Message de votre locataire ${access.tenant_name}`,
      body: `Message reçu depuis l'espace locataire self-service :\n\n${message}\n\n— ${access.tenant_name} (${access.email})`
    });

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}