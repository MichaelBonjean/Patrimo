import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateAndRenewAccess, buildAddress } from '../../shared/tenantPortal.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const token = body?.token;
    if (!token) return Response.json({ valid: false, code: 'not_found' }, { status: 404 });

    const ctx = await validateAndRenewAccess(svc, token, { req });
    if (!ctx.ok) {
      const status = ctx.code === 'rate_limited' ? 429 : 403;
      return Response.json({ valid: false, code: ctx.code }, { status });
    }

    const { access, lot, property, tenant } = ctx;

    let landlordName = '';
    try {
      const users = await svc.entities.User.filter({ email: access.owner_id });
      if (users && users[0]) landlordName = users[0].full_name || '';
    } catch (_) {}

    // Quittances filtrées par le bail autorisé (+ owner_id en défense en profondeur).
    const qPred = access.lease_id ? { lease_id: access.lease_id } : { lot_id: lot.id };
    const quittancesRaw = await svc.entities.Quittance.filter(qPred);
    const quittances = [...(quittancesRaw || [])]
      .filter((q) => !q.owner_id || !access.owner_id || q.owner_id === access.owner_id)
      .sort((a, b) => String(b.period || '').localeCompare(String(a.period || '')))
      .map((q) => ({
        id: q.id,
        receipt_number: q.receipt_number,
        year: q.year,
        month: q.month,
        period: q.period,
        rent_hc: q.rent_hc,
        charges: q.charges,
        assurance: q.assurance,
        total: q.total,
        total_due: q.total_due,
        paid_amount: q.paid_amount,
        landlord_name: q.landlord_name,
        landlord_address: q.landlord_address,
        tenant_name: q.tenant_name,
        tenant_address: q.tenant_address,
        property_name: q.property_name,
        lot_designation: q.lot_designation,
        lot_address: q.lot_address,
        payment_method: q.payment_method,
        payment_date: q.payment_date,
        issue_date: q.issue_date,
        status: q.status
      }));

    // Paiements: exclusivement Payment du bail autorisé (jamais Transaction income du lot).
    let paymentsRaw: any[] = [];
    if (access.lease_id) {
      paymentsRaw = await svc.entities.Payment.filter({ lease_id: access.lease_id });
    } else {
      // Legacy sans bail: aucune source de paiement fiable — on ne renvoie rien (sécurité).
      paymentsRaw = [];
    }
    const payments = [...(paymentsRaw || [])]
      .filter((p) => !p.owner_id || !access.owner_id || p.owner_id === access.owner_id)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .map((p) => ({
        id: p.id,
        date: p.date,
        amount: p.amount,
        method: p.method,
        payer_type: p.payer_type,
        reference: p.reference,
        notes: p.notes
      }));

    return Response.json({
      valid: true,
      tenant: {
        id: tenant?.id || '',
        name: access.tenant_name || tenant?.name || '',
        email: access.email || tenant?.email || '',
        phone: tenant?.phone || ''
      },
      lot: {
        designation: lot.designation || '',
        address: buildAddress(property)
      },
      property: {
        name: property?.name || '',
        landlord_name: landlordName,
        contact_available: !!(property && property.landlord_email)
      },
      quittances,
      payments
    });
  } catch (error) {
    return Response.json({ valid: false, code: 'error', message: error.message }, { status: 500 });
  }
}