import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateAndRenewAccess } from '../../shared/tenantPortal.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const token = body.token;
    const subject = (body.subject || '').toString().trim();
    const description = (body.description || '').toString().trim();
    if (!token) return Response.json({ ok: false, code: 'not_found' }, { status: 404 });
    if (!subject) return Response.json({ ok: false, error: 'Objet requis' }, { status: 400 });

    const ctx = await validateAndRenewAccess(svc, token, { req });
    if (!ctx.ok) {
      const status = ctx.code === 'rate_limited' ? 429 : 403;
      return Response.json({ ok: false, code: ctx.code }, { status });
    }
    const { access, lot, lease } = ctx;

    // L'incident est ancré sur la chaîne autorisée (jamais sur des identifiants
    // provenant du corps de la requête — qui pourrait être falsifié).
    const incident = await svc.entities.Incident.create({
      owner_id: access.owner_id,
      is_demo: access.is_demo || false,
      lot_id: lot.id,
      property_id: access.property_id || lot.property_id,
      tenant_name: access.tenant_name,
      reported_by_email: access.email,
      channel: 'portail',
      subject,
      description,
      status: 'ouvert',
      priority: 'normale'
    });

    return Response.json({ ok: true, id: incident.id, lease_id: lease?.id || access.lease_id || '' });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}