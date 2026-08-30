import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { can, requirePermission, normalizeRole } from '../../shared/rbac.ts';
import { logAction } from '../../shared/audit.ts';

/**
 * Gestion des accès patrimoine (rôles multi-utilisateurs).
 *  - op 'resolveMe'   : provisionne/active le contexte patrimoine du current user
 *                       (auto-crée OWNER au premier accès ; active les invités).
 *  - op 'list'        : liste les membres du patrimoine.
 *  - op 'invite'      : invite un email avec un rôle (OWNER/ADMIN uniquement).
 *  - op 'updateRole'  : modifie le rôle d'un membre (OWNER/ADMIN).
 *  - op 'revoke'      : révoque un membre (OWNER/ADMIN).
 *  - op 'reactivate'  : réactive un membre révoqué (OWNER/ADMIN).
 *  - op 'auditLog'    : renvoie le journal d'audit (rôles avec view_audit_log).
 *
 * Les opérations d'administration sont journalisées (audit admin_access).
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const op = body.op || 'resolveMe';
    const email = user.email;

    // ---------- resolveMe (appelé au login par AuthContext) ----------
    if (op === 'resolveMe') {
      const existing = await svc.entities.PatrimonyMember.filter({ user_email: email });
      let member = existing[0] || null;

      if (!member) {
        // Bootstrap : aucun membre → cet utilisateur devient OWNER de son patrimoine
        member = await svc.entities.PatrimonyMember.create({
          patrimony_id: email,
          user_email: email,
          full_name: user.full_name || email,
          patrimony_role: 'OWNER',
          status: 'active',
          invited_date: new Date().toISOString(),
          activated_date: new Date().toISOString(),
          added_by: email,
        });
      } else if (member.status === 'revoked') {
        return Response.json(
          { error: 'access_revoked', message: 'Votre accès à ce patrimoine a été révoqué.' },
          { status: 403 }
        );
      } else if (member.status === 'invited') {
        member = await svc.entities.PatrimonyMember.update(member.id, {
          status: 'active',
          activated_date: new Date().toISOString(),
        });
      }

      const patrimony_id = member.patrimony_id;
      const patrimony_role = member.patrimony_role;
      try {
        await base44.auth.updateMe({ patrimony_id, patrimony_role });
      } catch (e) {
        // updateMe peut échouer sur champs built-in; on ignore — le contexte est renvoyé au frontend.
      }
      return Response.json({ patrimony_id, patrimony_role, member });
    }

    // ---------- opérations suivantes: nécessitent un contexte résolu ----------
    const patrimony_id = user.patrimony_id || email;
    const role = user.patrimony_role;

    if (op === 'list') {
      const members = await svc.entities.PatrimonyMember.filter({ patrimony_id });
      return Response.json({ members, current_user: { email, role, patrimony_id } });
    }

    if (op === 'invite') {
      requirePermission(role, 'manage_team');
      const targetEmail = String(body.email || '').trim().toLowerCase();
      const targetRole = normalizeRole(body.role);
      if (!targetEmail) return Response.json({ error: 'email requis' }, { status: 400 });
      if (!targetRole) return Response.json({ error: 'rôle invalide' }, { status: 400 });
      if (targetRole === 'OWNER') return Response.json({ error: 'Le rôle OWNER n\'est pas attribuable par invitation' }, { status: 400 });
      const existing = await svc.entities.PatrimonyMember.filter({ patrimony_id, user_email: targetEmail });
      if (existing[0]) return Response.json({ error: 'membre déjà existant' }, { status: 409 });
      const member = await svc.entities.PatrimonyMember.create({
        patrimony_id,
        user_email: targetEmail,
        full_name: body.full_name || targetEmail,
        patrimony_role: targetRole,
        status: 'invited',
        invited_date: new Date().toISOString(),
        added_by: email,
        allowed_holders: Array.isArray(body.allowed_holders) ? body.allowed_holders : [],
      });
      try { await base44.users.inviteUser(targetEmail, 'user'); } catch (e) { /* déjà invité */ }
      await logAction(svc, {
        patrimony_id, actor_email: email, actor_role: role, action: 'admin_access',
        entity_type: 'PatrimonyMember', entity_id: member.id, entity_label: targetEmail,
        details: { role: targetRole, full_name: body.full_name || '' }, req,
      });
      return Response.json({ member });
    }

    if (op === 'updateRole') {
      requirePermission(role, 'manage_team');
      const targetRole = normalizeRole(body.role);
      if (!targetRole) return Response.json({ error: 'rôle invalide' }, { status: 400 });
      const members = await svc.entities.PatrimonyMember.filter({ patrimony_id, user_email: body.email });
      const m = members[0];
      if (!m) return Response.json({ error: 'membre introuvable' }, { status: 404 });
      if (m.patrimony_role === 'OWNER') return Response.json({ error: 'rôle OWNER non modifiable' }, { status: 400 });
      const updated = await svc.entities.PatrimonyMember.update(m.id, {
        patrimony_role: targetRole,
        allowed_holders: Array.isArray(body.allowed_holders) ? body.allowed_holders : m.allowed_holders,
      });
      await logAction(svc, {
        patrimony_id, actor_email: email, actor_role: role, action: 'admin_access',
        entity_type: 'PatrimonyMember', entity_id: m.id, entity_label: m.user_email,
        details: { from: m.patrimony_role, to: targetRole }, req,
      });
      return Response.json({ member: updated });
    }

    if (op === 'revoke') {
      requirePermission(role, 'manage_team');
      const members = await svc.entities.PatrimonyMember.filter({ patrimony_id, user_email: body.email });
      const m = members[0];
      if (!m) return Response.json({ error: 'membre introuvable' }, { status: 404 });
      if (m.patrimony_role === 'OWNER') return Response.json({ error: 'Le OWNER ne peut pas être révoqué' }, { status: 400 });
      const updated = await svc.entities.PatrimonyMember.update(m.id, {
        status: 'revoked', revoked_date: new Date().toISOString(),
      });
      await logAction(svc, {
        patrimony_id, actor_email: email, actor_role: role, action: 'admin_access',
        entity_type: 'PatrimonyMember', entity_id: m.id, entity_label: m.user_email,
        details: { revoke: true, previous_role: m.patrimony_role }, req,
      });
      return Response.json({ member: updated });
    }

    if (op === 'reactivate') {
      requirePermission(role, 'manage_team');
      const members = await svc.entities.PatrimonyMember.filter({ patrimony_id, user_email: body.email });
      const m = members[0];
      if (!m) return Response.json({ error: 'membre introuvable' }, { status: 404 });
      const updated = await svc.entities.PatrimonyMember.update(m.id, { status: 'active', revoked_date: null });
      await logAction(svc, {
        patrimony_id, actor_email: email, actor_role: role, action: 'admin_access',
        entity_type: 'PatrimonyMember', entity_id: m.id, entity_label: m.user_email,
        details: { reactivate: true }, req,
      });
      return Response.json({ member: updated });
    }

    if (op === 'auditLog') {
      if (!can(role, 'view_audit_log')) return Response.json({ error: 'Forbidden' }, { status: 403 });
      const limit = Math.min(500, Number(body.limit) || 200);
      const entries = await svc.entities.AuditLog.filter({ patrimony_id }, '-date', limit);
      return Response.json({ entries });
    }

    return Response.json({ error: 'op inconnu' }, { status: 400 });
  } catch (error: any) {
    const status = error.status || 500;
    return Response.json({ error: error.message || 'Erreur serveur' }, { status });
  }
}