import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { normalizeRole } from '../../shared/rbac.ts';
import { logAction } from '../../shared/audit.ts';

/**
 * Point d'entrée d'audit pour les opérations sensibles effectuées côté client
 * (création / modification / suppression d'objets du patrimoine). Le frontend
 * appelle cette fonction après une mutation directe (SDK entité) pour tracer
 * qui / quoi / quand / sur quel objet, dans le journal partagé du patrimoine.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const patrimony_id = user.patrimony_id || user.email;
    await logAction(svc, {
      patrimony_id,
      actor_email: user.email,
      actor_role: normalizeRole(user.patrimony_role),
      action: body.action || 'other',
      entity_type: body.entity_type,
      entity_id: body.entity_id,
      entity_label: body.entity_label,
      details: body.details || {},
      req,
    });
    return Response.json({ ok: true });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}