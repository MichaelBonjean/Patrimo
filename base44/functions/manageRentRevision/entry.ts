import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { computeRevision } from '../../shared/rentIndexEngine.ts';

/**
 * Révision automatique des loyers (IRL / ILC / ILAT / aucune).
 *
 *  - op 'analyze'   : calcule + persiste une proposition pour chaque bail du bailleur.
 *  - op 'compute'   : (re)calcule une proposition pour un bail (indice courant éditable).
 *  - op 'validate'  : le bailleur valide la proposition -> nouveau montant verrouillé.
 *  - op 'reject'    : refus de la proposition.
 *  - op 'apply'     : applique explicitement le nouveau loyer au bail (jamais automatique).
 *
 * Aucune révision n'est appliquée sans action expresse du bailleur.
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

    const leaseInfo = (lease, lot, property) => ({
      id: lease.id,
      lot_id: lease.lot_id,
      lot_designation: lot?.designation || '',
      property_id: lease.property_id,
      property_name: property?.name || '',
      rent_excluding_charges: lease.rent_excluding_charges,
      indexation_type: lease.indexation_type || 'aucune',
      index_reference: lease.index_reference || '',
      index_value_initial: lease.index_value_initial,
      index_value_current: lease.index_value_current,
      last_revision_date: lease.last_revision_date,
      next_revision_date: lease.next_revision_date,
      date_start: lease.date_start,
    });

    const buildProposal = (lease, lot, newIdxOverride) => {
      const newIdx = newIdxOverride != null ? Number(newIdxOverride) : Number(lease.index_value_current);
      return computeRevision({
        indexation_type: lease.indexation_type || 'aucune',
        oldRent: Number(lease.rent_excluding_charges) || 0,
        oldIndexValue: lease.index_value_initial,
        newIndexValue: newIdx,
        lastRevisionDate: lease.last_revision_date,
        dateStart: lease.date_start,
        dpeClass: lot?.dpe_class,
        proposalDate: today,
      });
    };

    const upsertProposal = async (lease, res) => {
      const existing = await svc.entities.RentRevision.filter({ owner_id: owner, lease_id: lease.id });
      const active = existing
        .filter((e) => e.status === 'proposition')
        .sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')))[0];
      const payload = {
        owner_id: owner,
        is_demo: false,
        lease_id: lease.id,
        lot_id: lease.lot_id,
        property_id: lease.property_id,
        indexation_type: lease.indexation_type || 'aucune',
        reference_quarter: lease.index_reference || '',
        old_rent: res.oldRent,
        old_index_value: res.oldIndexValue,
        new_index_value: res.newIndexValue,
        new_rent: res.newRent,
        variation_amount: res.variationAmount,
        variation_percent: res.variationPercent,
        formula: res.formula,
        new_revision_date: res.nextRevisionDate,
        blocked_reason: res.blockedReason,
        can_apply: res.canApply,
        status: 'proposition',
        actor: owner,
      };
      if (active) {
        return await svc.entities.RentRevision.update(active.id, payload);
      }
      return await svc.entities.RentRevision.create(payload);
    };

    if (op === 'analyze') {
      const [leases, lots, properties] = await Promise.all([
        svc.entities.Lease.filter({ owner_id: owner }),
        svc.entities.Lot.filter({ owner_id: owner }),
        svc.entities.Property.filter({ owner_id: owner }),
      ]);
      const out = [];
      for (const lease of leases) {
        const lot = lots.find((l) => l.id === lease.lot_id) || null;
        const property = properties.find((p) => p.id === lease.property_id) || null;
        const res = buildProposal(lease, lot);
        const record = await upsertProposal(lease, res);
        out.push({ ...res, record, lease: leaseInfo(lease, lot, property) });
      }
      return Response.json({ proposals: out });
    }

    if (op === 'compute') {
      if (!body.lease_id) return Response.json({ error: 'lease_id requis' }, { status: 400 });
      const [leases, lots, properties] = await Promise.all([
        svc.entities.Lease.filter({ owner_id: owner }),
        svc.entities.Lot.filter({ owner_id: owner }),
        svc.entities.Property.filter({ owner_id: owner }),
      ]);
      const lease = leases.find((l) => l.id === body.lease_id);
      if (!lease) return Response.json({ error: 'Bail introuvable' }, { status: 404 });
      const lot = lots.find((l) => l.id === lease.lot_id) || null;
      const property = properties.find((p) => p.id === lease.property_id) || null;
      const res = buildProposal(lease, lot, body.new_index_value);
      if (body.new_index_value != null) {
        const nv = Number(body.new_index_value);
        if (!Number.isNaN(nv) && nv !== (Number(lease.index_value_current) || 0)) {
          await svc.entities.Lease.update(lease.id, { index_value_current: nv });
        }
      }
      const record = await upsertProposal(lease, res);
      return Response.json({ proposal: { ...res, record, lease: leaseInfo(lease, lot, property) } });
    }

    const getRev = async (id) => {
      const recs = await svc.entities.RentRevision.filter({ owner_id: owner });
      return recs.find((r) => r.id === id) || null;
    };

    if (op === 'validate') {
      const rev = await getRev(body.rent_revision_id);
      if (!rev) return Response.json({ error: 'Proposition introuvable' }, { status: 404 });
      if (rev.status !== 'proposition') return Response.json({ error: 'Proposition déjà traitée' }, { status: 400 });
      const updated = await svc.entities.RentRevision.update(rev.id, {
        status: 'validee',
        new_amount: rev.new_rent,
        validated_date: today,
        actor: owner,
      });
      return Response.json({ ok: true, record: updated });
    }

    if (op === 'reject') {
      const rev = await getRev(body.rent_revision_id);
      if (!rev) return Response.json({ error: 'Proposition introuvable' }, { status: 404 });
      if (rev.status === 'appliquee') return Response.json({ error: 'Proposition déjà appliquée' }, { status: 400 });
      const updated = await svc.entities.RentRevision.update(rev.id, { status: 'refusee', actor: owner });
      return Response.json({ ok: true, record: updated });
    }

    if (op === 'apply') {
      const rev = await getRev(body.rent_revision_id);
      if (!rev) return Response.json({ error: 'Proposition introuvable' }, { status: 404 });
      if (rev.status !== 'validee') return Response.json({ error: "Validez la proposition avant de l'appliquer" }, { status: 400 });
      const leases = await svc.entities.Lease.filter({ owner_id: owner });
      const lease = leases.find((l) => l.id === rev.lease_id);
      if (lease) {
        await svc.entities.Lease.update(lease.id, {
          rent_excluding_charges: rev.new_rent,
          index_value_initial: rev.new_index_value,
          index_value_current: rev.new_index_value,
          last_revision_date: today,
          next_revision_date: rev.new_revision_date,
        });
      }
      const updated = await svc.entities.RentRevision.update(rev.id, {
        status: 'appliquee',
        applied_date: today,
        actor: owner,
      });
      return Response.json({ ok: true, record: updated });
    }

    return Response.json({ error: 'op inconnu' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}