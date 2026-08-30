import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { computeRegularization, labelOfRecoverable } from '../../shared/chargeRegularizationEngine.ts';

/**
 * Régularisation des charges locatives.
 *
 *  - op 'analyze'  : provisions encaissées + régularisation existante par bail (année).
 *  - op 'save'     : enregistre/met à jour un brouillon (calcule le solde).
 *  - op 'validate' : valide la régularisation ; si solde > 0 crée une nouvelle
 *                    échéance dans le compte locataire (jamais automatiquement
 *                    pour un remboursement -> traité manuellement).
 *  - op 'delete'   : supprime la régularisation (et l'échéance créée si encore impayée).
 *
 * Charges récupérables (ventilation) et charges propriétaire ne sont jamais
 * mélangées : seule la ventilation catégorisée (catalogue dédié) alimente le
 * total récupérable.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const owner = user.email;
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const op = body.op || 'analyze';
    const today = new Date().toISOString().slice(0, 10);

    const snap = (lease, lot, property) => ({
      tenant_name: lease.tenants?.[0]?.name || '',
      lot_designation: lot?.designation || '',
      property_name: property?.name || '',
      lot_address: [property?.address, property?.postal_code, property?.city].filter(Boolean).join(' '),
    });

    if (op === 'analyze') {
      const year = Number(body.year);
      if (!year) return Response.json({ error: 'year requis' }, { status: 400 });
      const [leases, lots, properties, rentDues, existing] = await Promise.all([
        svc.entities.Lease.filter({ owner_id: owner }),
        svc.entities.Lot.filter({ owner_id: owner }),
        svc.entities.Property.filter({ owner_id: owner }),
        svc.entities.RentDue.filter({ owner_id: owner, year }),
        svc.entities.ChargeRegularization.filter({ owner_id: owner, year }),
      ]);
      const provByLease: Record<string, number> = {};
      for (const d of rentDues) {
        // Les échéances de régularisation (créées par ce module) ne sont pas
        // des provisions mensuelles : on les exclut du calcul des provisions.
        if ((d.notes || '').startsWith('Régularisation des charges')) continue;
        const k = d.lease_id;
        provByLease[k] = R2((provByLease[k] || 0) + (Number(d.charges) || 0));
      }
      const rows = leases.map((lease) => {
        const lot = lots.find((l) => l.id === lease.lot_id) || null;
        const property = properties.find((p) => p.id === lease.property_id) || null;
        const record = existing.find((r) => r.lease_id === lease.id) || null;
        return {
          lease: {
            id: lease.id, lot_id: lease.lot_id, property_id: lease.property_id,
            lot_designation: lot?.designation || '', property_name: property?.name || '',
            tenant_name: lease.tenants?.[0]?.name || '',
            lot_address: [property?.address, property?.postal_code, property?.city].filter(Boolean).join(' '),
            lease_type: lease.lease_type, status: lease.status, date_start: lease.date_start,
          },
          provisions_collected: R2(provByLease[lease.id] || 0),
          record,
        };
      });
      return Response.json({ rows });
    }

    if (op === 'save') {
      const leaseId = body.lease_id;
      const year = Number(body.year);
      if (!leaseId || !year) return Response.json({ error: 'lease_id et year requis' }, { status: 400 });
      const [leases, lots, properties, rentDues] = await Promise.all([
        svc.entities.Lease.filter({ owner_id: owner }),
        svc.entities.Lot.filter({ owner_id: owner }),
        svc.entities.Property.filter({ owner_id: owner }),
        svc.entities.RentDue.filter({ owner_id: owner, year }),
      ]);
      const lease = leases.find((l) => l.id === leaseId);
      if (!lease) return Response.json({ error: 'Bail introuvable' }, { status: 404 });
      const lot = lots.find((l) => l.id === lease.lot_id) || null;
      const property = properties.find((p) => p.id === lease.property_id) || null;
      let provisions = 0;
      for (const d of rentDues) {
        if (d.lease_id === leaseId && !((d.notes || '').startsWith('Régularisation des charges'))) {
          provisions += Number(d.charges) || 0;
        }
      }
      const ventilation = (body.ventilation || []).map((v) => ({
        category: v.category,
        category_label: labelOfRecoverable(v.category) || v.category_label || v.category,
        amount: Number(v.amount) || 0,
        note: v.note || '',
      }));
      const calc = computeRegularization(provisions, ventilation);
      const s = snap(lease, lot, property);
      const payload = {
        owner_id: owner, is_demo: false,
        lease_id: lease.id, lot_id: lease.lot_id, property_id: lease.property_id,
        year, period: body.period || String(year),
        ...s, landlord_name: user.full_name || owner,
        status: 'draft',
        provisions_collected: calc.provisions_collected,
        recoverable_total: calc.recoverable_total,
        teom_recoverable: calc.teom_recoverable,
        solde: calc.solde, direction: calc.direction,
        ventilation, justificatifs: body.justificatifs || [],
        note: body.note || '',
        actor: owner,
      };
      let record;
      if (body.id) {
        const recs = await svc.entities.ChargeRegularization.filter({ owner_id: owner });
        const cur = recs.find((r) => r.id === body.id && r.status === 'draft');
        if (cur) record = await svc.entities.ChargeRegularization.update(cur.id, payload);
      }
      if (!record) {
        const recs = await svc.entities.ChargeRegularization.filter({ owner_id: owner, year });
        const draft = recs.find((r) => r.lease_id === leaseId && r.status === 'draft');
        if (draft) record = await svc.entities.ChargeRegularization.update(draft.id, payload);
        else record = await svc.entities.ChargeRegularization.create(payload);
      }
      return Response.json({ record });
    }

    if (op === 'validate') {
      if (!body.id) return Response.json({ error: 'id requis' }, { status: 400 });
      const recs = await svc.entities.ChargeRegularization.filter({ owner_id: owner });
      const rec = recs.find((r) => r.id === body.id);
      if (!rec) return Response.json({ error: 'Régularisation introuvable' }, { status: 404 });
      if (rec.status === 'validee') return Response.json({ error: 'Déjà validée' }, { status: 400 });
      const calc = computeRegularization(rec.provisions_collected || 0, rec.ventilation || []);
      let due_rentdue_id = rec.due_rentdue_id || null;
      if (calc.solde > 0 && !due_rentdue_id) {
        const dv = new Date();
        const month = dv.getMonth() + 1;
        const period = `${rec.year}-${String(month).padStart(2, '0')}`;
        const due = await svc.entities.RentDue.create({
          owner_id: owner, is_demo: false,
          lease_id: rec.lease_id, property_id: rec.property_id, lot_id: rec.lot_id,
          year: rec.year, month, period, due_date: today,
          rent_excluding_charges: 0, charges: calc.solde, additional_amount: 0,
          total_due: calc.solde, paid_amount: 0, balance: calc.solde,
          status: 'unpaid', tenant_name: rec.tenant_name,
          notes: `Régularisation des charges ${rec.period || rec.year}`,
        });
        due_rentdue_id = due.id;
      }
      const updated = await svc.entities.ChargeRegularization.update(rec.id, {
        status: 'validee',
        solde: calc.solde, direction: calc.direction,
        recoverable_total: calc.recoverable_total, teom_recoverable: calc.teom_recoverable,
        due_rentdue_id, validation_date: today, actor: owner,
      });
      return Response.json({ ok: true, record: updated, due_rentdue_id, direction: calc.direction, solde: calc.solde });
    }

    if (op === 'delete') {
      if (!body.id) return Response.json({ error: 'id requis' }, { status: 400 });
      const recs = await svc.entities.ChargeRegularization.filter({ owner_id: owner });
      const rec = recs.find((r) => r.id === body.id);
      if (!rec) return Response.json({ error: 'Introuvable' }, { status: 404 });
      if (rec.due_rentdue_id) {
        try {
          const dues = await svc.entities.RentDue.filter({ owner_id: owner });
          const due = dues.find((d) => d.id === rec.due_rentdue_id);
          if (due && (due.status === 'unpaid') && (Number(due.paid_amount) || 0) === 0) {
            await svc.entities.RentDue.delete(due.id);
          }
        } catch (_) { /* ne pas bloquer la suppression de la régularisation */ }
      }
      await svc.entities.ChargeRegularization.delete(rec.id);
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'op inconnu' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function R2(n: number): number { return Math.round((Number(n) || 0) * 100) / 100; }