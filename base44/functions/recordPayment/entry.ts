import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { R2, allocateFifo, recalcDue, PAYER_TYPES, PAYMENT_METHODS } from '../../shared/rentLedger.ts';
import { syncImpayesForLease } from '../../shared/impayeEngine.ts';

/**
 * Enregistre un paiement de loyer et l'affecte sur les échéances d'un bail.
 * - Authentifié (admin ou user), et le bail doit appartenir à l'utilisateur
 *   (owner_id === user.email) : aucune confiance au owner_id du frontend.
 * - Sans `allocations` explicites : affectation FIFO automatique sur les
 *   échéances les plus anciennes (plafonnée au solde ; excédent = crédit).
 * - Avec `allocations` explicites : on respecte la répartition demandée, ce
 *   qui permet un trop-perçu (overpaid) sur une échéance précise.
 * - Recalcule ensuite le statut de chaque échéance touchée, puis resynchronise
 *   les impayés du bail (création / mise à jour / régularisation automatique).
 *
 * Payload:
 *  { lease_id, date, amount, payer_type, payer_name?, method?, reference?,
 *    notes?, transaction_id?, allocations?: [{rent_due_id, amount}] }
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' && user.role !== 'user') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: any = {};
    try { body = await req.json(); } catch (_e) {
      return Response.json({ error: 'Corps de requête invalide' }, { status: 400 });
    }

    const lease_id = String(body.lease_id || '');
    const date = String(body.date || '');
    const amount = Number(body.amount);
    const payer_type = String(body.payer_type || '');
    const payer_name = String(body.payer_name || '');
    const method = body.method ? String(body.method) : '';
    const reference = String(body.reference || '');
    const notes = String(body.notes || '');
    const transaction_id = body.transaction_id ? String(body.transaction_id) : '';

    if (!lease_id) return Response.json({ error: 'lease_id requis' }, { status: 400 });
    if (!date) return Response.json({ error: 'date requise' }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: 'Le montant doit être un nombre > 0' }, { status: 400 });
    }
    if (!PAYER_TYPES.includes(payer_type as any)) {
      return Response.json({ error: 'payer_type invalide' }, { status: 400 });
    }
    if (method && !PAYMENT_METHODS.includes(method as any)) {
      return Response.json({ error: 'method invalide' }, { status: 400 });
    }

    const svc = base44.asServiceRole;
    let lease: any;
    try {
      lease = await svc.entities.Lease.get(lease_id);
    } catch (_e) {
      return Response.json({ error: 'Bail introuvable' }, { status: 404 });
    }
    if (!lease || lease.owner_id !== user.email) {
      return Response.json({ error: 'Bail introuvable' }, { status: 404 });
    }

    const dues: any[] = await svc.entities.RentDue.filter({ lease_id: lease.id });

    let allocations: { rent_due_id: string; amount: number }[] = [];
    let unallocated = 0;

    if (Array.isArray(body.allocations) && body.allocations.length) {
      const dueIds = new Set(dues.map((d) => d.id));
      let sum = 0;
      for (const a of body.allocations) {
        const rid = String(a?.rent_due_id || '');
        const amt = Number(a?.amount);
        if (!rid || !dueIds.has(rid)) {
          return Response.json({ error: 'Affectation: échéance inconnue' }, { status: 400 });
        }
        if (!Number.isFinite(amt) || amt <= 0) {
          return Response.json({ error: 'Affectation: montant invalide' }, { status: 400 });
        }
        sum = R2(sum + amt);
        allocations.push({ rent_due_id: rid, amount: R2(amt) });
      }
      if (sum > R2(amount) + 0.01) {
        return Response.json({ error: 'La somme des affectations dépasse le montant du paiement' }, { status: 400 });
      }
      unallocated = R2(amount - sum);
    } else {
      const r = allocateFifo(dues, amount);
      allocations = r.allocations;
      unallocated = r.unallocated;
    }

    const payment = await svc.entities.Payment.create({
      owner_id: lease.owner_id,
      is_demo: !!lease.is_demo,
      lease_id: lease.id,
      rent_due_id: allocations[0]?.rent_due_id || '',
      date,
      amount: R2(amount),
      payer_type,
      payer_name,
      method,
      reference,
      notes,
      transaction_id,
      allocations,
      unallocated,
    });

    // Recalcul des échéances touchées (cumul des paiements existants + ce paiement).
    const allPayments: any[] = await svc.entities.Payment.filter({ lease_id: lease.id });

    const dueById = new Map(dues.map((d) => [d.id, d]));
    const touched = new Set(allocations.map((a) => a.rent_due_id));
    const updated: string[] = [];
    for (const id of touched) {
      let paid = 0;
      for (const p of allPayments) {
        for (const a of p.allocations || []) {
          if (a.rent_due_id === id) paid = R2(paid + Number(a.amount) || 0);
        }
      }
      const rec = recalcDue(dueById.get(id), paid);
      await svc.entities.RentDue.update(id, {
        paid_amount: rec.paid_amount,
        balance: rec.balance,
        status: rec.status,
      });
      updated.push(id);
    }

    // Resynchronise les impayés du bail (met à jour outstanding / régularisation).
    const imp = await syncImpayesForLease(svc, lease.id);

    return Response.json({
      ok: true,
      payment_id: payment.id,
      allocations,
      unallocated,
      updated,
      impayes: imp,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}