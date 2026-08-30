import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { reconcileBankTransaction, suggestRuleFromProposal } from '../../shared/bankReconcileEngine.ts';
import { loadReconcileContext, findAccountForBt } from '../../shared/reconcileContext.ts';
import { R2, recalcDue } from '../../shared/rentLedger.ts';
import { syncImpayesForLease } from '../../shared/impayeEngine.ts';
import { labelOf, resolveKey } from '../../shared/financeCategories.ts';
import { hasValidAllocation, deriveAllocationType } from '../../shared/allocationEngine.ts';

/**
 * VALIDATION D'UNE PROPOSITION DE RAPPROCHEMENT — applique la décision
 * utilisateur sur une BankTransaction brute : crée la Transaction (interprétation
 * financière) et, le cas échéant, le Payment + mise à jour du RentDue, puis
 * lie la BankTransaction (status=linked, snapshot). Optionnellement apprend
 * une BankRule depuis la correction utilisateur.
 *
 * Décisions :
 *   validate : applique la proposition du moteur telle quelle.
 *   modify   : applique la override { category, property_id, lot_id, lease_id,
 *              rent_due_id } fournie par l'utilisateur (jamais de devinette).
 *   ignore   : marque la BankTransaction ignored (brute préservée, non liée).
 *
 * Effets :
 *   - Transaction créée depuis transaction_patch (+ owner_id).
 *   - Si payment_patch (rente) : Payment créé, allocations appliquées, RentDue
 *     recalculé (paid_amount/balance/status), impayés resynchronisés.
 *   - BankTransaction.status=linked, transaction_id + snapshot cat/bien/lot.
 *   - learn_rule=true (défaut) sur modify/validate(proposed) → BankRule créée
 *     via suggestRuleFromProposal (apprentissage déterministe).
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

    const bt_id = String(body.bank_transaction_id || '');
    const decision = String(body.decision || 'validate');
    const override = body.override || null;
    const learn_rule = body.learn_rule !== false;

    if (!bt_id) return Response.json({ error: 'bank_transaction_id requis' }, { status: 400 });
    if (!['validate', 'modify', 'ignore'].includes(decision)) {
      return Response.json({ error: 'decision invalide (validate|modify|ignore)' }, { status: 400 });
    }

    const svc = base44.asServiceRole;

    let bt: any;
    try { bt = await svc.entities.BankTransaction.get(bt_id); } catch (_e) {
      return Response.json({ error: 'BankTransaction introuvable' }, { status: 404 });
    }
    if (!bt || bt.owner_id !== user.email) {
      return Response.json({ error: 'BankTransaction introuvable' }, { status: 404 });
    }

    // IGNORER — la brute est préservée (jamais supprimée), juste écartée.
    if (decision === 'ignore') {
      await svc.entities.BankTransaction.update(bt_id, { status: 'ignored' });
      return Response.json({ ok: true, decision: 'ignore', bank_transaction_id: bt_id });
    }

    // Reconstruit la proposition moteur pour cette ligne (contexte owner).
    const ctx = await loadReconcileContext(svc, user.email);
    const account = findAccountForBt(ctx.accounts, bt);
    const proposal = reconcileBankTransaction(bt, { ...ctx, account, transfert_pool: [bt] });

    // PATCH Transaction — base = moteur, surchargé par la correction utilisateur.
    const txPatch: any = { ...(proposal.transaction_patch || {}) };
    if (decision === 'modify' && override) {
      if (override.category) txPatch.category = resolveKey(override.category);
      if (override.property_id !== undefined) txPatch.property_id = override.property_id || null;
      if (override.lot_id !== undefined) txPatch.lot_id = override.lot_id || null;
      if (override.holder_id !== undefined) txPatch.holder_id = override.holder_id || null;
      if (override.loan_id !== undefined) txPatch.loan_id = override.loan_id || null;
      if (override.tax_scope !== undefined) txPatch.tax_scope = override.tax_scope || null;
      if (override.allocation_type !== undefined) txPatch.allocation_type = override.allocation_type;
    }
    txPatch.category_label = labelOf(txPatch.category);
    txPatch.owner_id = user.email;
    txPatch.bank_import_id = bt.bank_import_id || bt.source_import_id || null;
    // Une dépense sans bien, sur un compte rattaché à une structure (SCI), est
    // présomtée affectée à la structure (holder_id du BankAccount) plutôt que
    // refusée. L'utilisateur peut surcharger via « Modifier ».
    if (txPatch.type === 'expense' && !txPatch.property_id && !txPatch.holder_id && account?.holder_id) {
      txPatch.holder_id = account.holder_id;
    }
    // allocation_type dérivé des champs (property/lot/holder/loan/tax/internal_transfer/unallocated).
    txPatch.allocation_type = deriveAllocationType(txPatch);

    // Garde-fou : une dépense doit porter au moins une affectation cohérente
    // (bien, lot, structure/SCI, prêt, ou périmètre fiscal). Une dépense « non
    // affectée » est refusée — mais sans imposer property_id à une dépense
    // générale de SCI (holder_id seul suffit).
    if (txPatch.type === 'expense' && !hasValidAllocation(txPatch)) {
      return Response.json(
        { error: 'Affectez au moins une cible (bien, lot, structure, prêt ou fiscalité) via « Modifier » avant de valider cette dépense.' },
        { status: 400 }
      );
    }

    // 1. Transaction métier.
    const tx = await svc.entities.Transaction.create(txPatch);

    // 2. Payment (rente) si la proposition identifie un loyer (ou override loyer).
    let payment_id: string | null = null;
    const rent_due_updates: string[] = [];
    const rentProposal = (decision === 'modify' && override && override.lease_id)
      ? { lease_id: override.lease_id, rent_due_id: override.rent_due_id }
      : (proposal.payment_patch ? { lease_id: proposal.payment_patch.lease_id, rent_due_id: proposal.rent_due_id } : null);

    if (rentProposal && rentProposal.lease_id && rentProposal.rent_due_id) {
      const lease: any = ctx.leases.find((l: any) => l.id === rentProposal.lease_id);
      if (!lease || lease.owner_id !== user.email) {
        return Response.json({ error: 'Bail introuvable pour le paiement' }, { status: 400 });
      }
      const dues: any[] = await svc.entities.RentDue.filter({ lease_id: lease.id });
      const due = dues.find((d) => d.id === rentProposal.rent_due_id);
      if (!due) return Response.json({ error: 'Échéance introuvable' }, { status: 400 });

      const amount = Math.abs(Number(bt.amount) || 0);
      const balance = R2((Number(due.total_due) || 0) - (Number(due.paid_amount) || 0));
      const allocated = Math.min(Math.max(0, balance), amount);
      if (allocated <= 0) {
        return Response.json({ error: 'Échéance déjà soldée — affectation impossible' }, { status: 400 });
      }
      const allocations = [{ rent_due_id: due.id, amount: R2(allocated) }];
      const unallocated = R2(amount - allocated);
      const payer_type = /caf|apl|allocation logement/i.test(String(bt.raw_description || '')) ? 'caf' : 'tenant';

      const payment = await svc.entities.Payment.create({
        owner_id: user.email,
        is_demo: !!bt.is_demo,
        lease_id: lease.id,
        rent_due_id: due.id,
        date: String(bt.date).slice(0, 10),
        amount: R2(amount),
        payer_type,
        payer_name: (due.tenant_name || lease.tenants?.[0]?.name || ''),
        method: 'virement',
        transaction_id: tx.id,
        allocations,
        unallocated,
      });
      payment_id = payment.id;

      // Recalcul cumulatif de l'échéance (paiements existants + celui-ci).
      const allPayments: any[] = await svc.entities.Payment.filter({ lease_id: lease.id });
      let paid = 0;
      for (const p of allPayments) for (const a of p.allocations || []) if (a.rent_due_id === due.id) paid = R2(paid + Number(a.amount));
      const rec = recalcDue(due, paid);
      await svc.entities.RentDue.update(due.id, { paid_amount: rec.paid_amount, balance: rec.balance, status: rec.status });
      rent_due_updates.push(due.id);

      // Resynchronise les impayés du bail.
      try { await syncImpayesForLease(svc, lease.id); } catch (_e) { /* best-effort */ }
    }

    // 3. Liaison BankTransaction → Transaction (status linked, snapshot affectation).
    await svc.entities.BankTransaction.update(bt_id, {
      status: 'linked',
      transaction_id: tx.id,
      category: txPatch.category,
      property_id: txPatch.property_id || '',
      lot_id: txPatch.lot_id || '',
    });

    // 4. Apprentissage déterministe — proposer une règle pour les prochains virements similaires.
    let rule_id: string | null = null;
    if (learn_rule && (decision === 'modify' || proposal.level !== 'automatic')) {
      try {
        const ruleSuggestion = suggestRuleFromProposal({ ...proposal, transaction_patch: txPatch }, bt);
        if (ruleSuggestion && ruleSuggestion.keyword) {
          const rule = await svc.entities.BankRule.create({
            owner_id: user.email,
            is_demo: !!bt.is_demo,
            keyword: ruleSuggestion.keyword,
            assigned_category: ruleSuggestion.assigned_category || txPatch.category,
            assigned_property_id: ruleSuggestion.assigned_property_id || txPatch.property_id || null,
            assigned_lot_id: ruleSuggestion.assigned_lot_id || txPatch.lot_id || null,
            is_active: true,
            priority: 50,
            source: 'learned_from_validation',
            learned_from_transaction_id: bt_id,
            match_count: 0,
            history: [{ date: new Date().toISOString(), action: 'created', actor: user.email, note: 'Apprise via rapprochement' }],
          });
          rule_id = rule.id;
        }
      } catch (_e) { /* apprentissage best-effort : ne bloque pas la validation */ }
    }

    return Response.json({
      ok: true,
      decision,
      bank_transaction_id: bt_id,
      transaction_id: tx.id,
      payment_id,
      rent_due_updates,
      rule_id,
      level: proposal.level,
    });
  } catch (error) {
    return Response.json({ error: (error as any)?.message || 'Erreur' }, { status: 500 });
  }
}