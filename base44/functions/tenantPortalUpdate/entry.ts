import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateAndRenewAccess } from '../../shared/tenantPortal.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const token = body.token;
    const phone = body.phone ?? null;
    const email = body.email ?? null;
    if (!token) return Response.json({ ok: false, code: 'not_found' }, { status: 404 });

    const ctx = await validateAndRenewAccess(svc, token, { req });
    if (!ctx.ok) {
      const status = ctx.code === 'rate_limited' ? 429 : 403;
      return Response.json({ ok: false, code: ctx.code }, { status });
    }
    const { access, lot } = ctx;

    const updateData: any = {};
    const tenants = Array.isArray(lot.tenants) ? [...lot.tenants] : [];
    const idx = access.tenant_id ? tenants.findIndex(t => t.id === access.tenant_id) : -1;
    if (idx >= 0) {
      tenants[idx] = {
        ...tenants[idx],
        ...(phone !== null ? { phone } : {}),
        ...(email !== null ? { email } : {})
      };
      updateData.tenants = tenants;
    } else {
      if (phone !== null) updateData.tenant_phone = phone;
      if (email !== null) updateData.tenant_email = email;
    }

    await svc.entities.Lot.update(lot.id, updateData);
    if (email !== null && email !== access.email) {
      await svc.entities.TenantAccess.update(access.id, { email });
    }

    return Response.json({ ok: true, phone, email });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}