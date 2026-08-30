import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  resolveTenant, addDaysISO, generateSecureToken, hashToken, revokeTenantAccessById
} from '../../shared/tenantPortal.ts';
import { loadActiveLease } from '../../shared/leaseResolve.ts';
import { renderEmailTemplate } from '../../shared/emailTemplates.ts';
import { sendEmailWithRetry } from '../../shared/emailService.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { lot_id, tenant_id, email: overrideEmail } = body;
    if (!lot_id) return Response.json({ error: 'lot_id requis' }, { status: 400 });

    const svc = base44.asServiceRole;

    const lot = await base44.entities.Lot.get(lot_id).catch(() => null);
    if (!lot) return Response.json({ error: 'Lot introuvable' }, { status: 404 });

    // Vérification d'appartenance explicite (serviceRole bypass RLS).
    if (lot.owner_id && lot.owner_id !== user.email) {
      return Response.json({ error: 'Lot non autorisé' }, { status: 403 });
    }

    const tenant = resolveTenant(lot, tenant_id);
    const tenantEmail = (overrideEmail || tenant?.email || lot.tenant_email || '').trim();
    if (!tenantEmail) {
      return Response.json({ error: "Email du locataire requis pour générer l'accès" }, { status: 400 });
    }

    // Résolution du bail actif du lot (ancre la chaîne d'autorisation).
    let leaseId = '';
    try {
      const lease = await loadActiveLease(svc, lot, { owner_id: user.email });
      if (lease && lease.id && !lease._legacy) leaseId = lease.id;
    } catch (_) { leaseId = ''; }

    // Révocation des accès précédents actifs pour ce lot/locataire (rotation automatique
    // à chaque nouvelle invitation — un seul jeton actif par couple lot/locataire).
    const prev = await svc.entities.TenantAccess.filter({ lot_id: lot.id, revoked_at: null });
    for (const a of (prev || [])) {
      if (!tenant_id || a.tenant_id === tenant_id) {
        await revokeTenantAccessById(svc, a.id);
      }
    }

    // Jeton cryptographiquement sûr — on ne stocke QUE le hash (+ legacy magic_token éphémère).
    const rawToken = generateSecureToken();
    const tokenHash = await hashToken(rawToken);
    const now = new Date();
    const expires_at = addDaysISO(now, 90);

    const access = await base44.entities.TenantAccess.create({
      owner_id: user.email,
      is_demo: lot.is_demo || false,
      lot_id: lot.id,
      property_id: lot.property_id,
      lease_id: leaseId,
      tenant_id: tenant?.id || '',
      tenant_name: tenant?.name || lot.tenant_name || '',
      email: tenantEmail,
      magic_token: rawToken,
      token_hash: tokenHash,
      token_version: 1,
      created_at: now.toISOString(),
      expires_at,
      issued_date: now.toISOString().slice(0, 10),
      revoked_at: null,
      last_used_at: null,
      last_accessed_date: null,
      failed_attempts: 0
    });

    // URL publique d'accès.
    let base = (req.headers.get('origin') || '').replace(/\/$/, '');
    if (!base) {
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
      const proto = req.headers.get('x-forwarded-proto') || 'https';
      if (host) base = `${proto}://${host}`;
    }
    const link = `${base}/portail/${rawToken}`;

    // Envoi transactionnel (multi-fournisseurs) — n'importe quelle adresse valide.
    let emailed = false;
    let email_status: string = 'failed';
    let email_error: string | undefined;
    try {
      const vars = {
        tenant_name: tenant?.name || lot.tenant_name || '',
        link,
        expires_days: 90,
        landlord_name: user.full_name || 'Votre bailleur',
      };
      const tpl = renderEmailTemplate('tenant_portal_invitation', vars);
      const r = await sendEmailWithRetry(svc, {
        to: tenantEmail,
        subject: tpl.subject, html: tpl.html, text: tpl.text,
        template: 'tenant_portal_invitation', variables: vars,
        owner_id: user.email, is_demo: lot.is_demo || false,
        related_entity_type: 'tenant_access', related_entity_id: access.id,
      });
      emailed = r.status === 'sent' || r.status === 'queued';
      email_status = r.status;
      email_error = r.error;
    } catch (e) {
      emailed = false;
      email_status = 'failed';
      email_error = e instanceof Error ? e.message : String(e);
    }

    return Response.json({ link, expires_at, emailed, email_status, email_error, access_id: access.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}