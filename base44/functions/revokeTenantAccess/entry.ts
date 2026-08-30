import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { revokeTenantAccessById } from '../../shared/tenantPortal.ts';

/**
 * Révocation explicite d'un accès locataire par le bailleur authentifié.
 * Vérification d'appartenance explicite (serviceRole bypass RLS).
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { access_id, token } = body;
    if (!access_id && !token) {
      return Response.json({ error: 'access_id ou token requis' }, { status: 400 });
    }

    const svc = base44.asServiceRole;

    let access: any = null;
    if (access_id) {
      try { access = await svc.entities.TenantAccess.get(access_id); } catch (_) { access = null; }
    } else if (token) {
      const { findAccessByToken } = await import('../../shared/tenantPortal.ts');
      access = await findAccessByToken(svc, token);
    }
    if (!access) return Response.json({ error: "Accès introuvable" }, { status: 404 });

    // Appartenance explicite — jamais de confiance dans les RLS côté serviceRole.
    if (access.owner_id !== user.email) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const ok = await revokeTenantAccessById(svc, access.id);
    return Response.json({ ok, access_id: access.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}