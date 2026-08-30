import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { reconcileBankTransaction, aggregateReconcile } from '../../shared/bankReconcileEngine.ts';
import { loadReconcileContext, findAccountForBt } from '../../shared/reconcileContext.ts';

/**
 * RAPPROCHEMENT BANCAIRE — exécute le moteur sur les BankTransaction brutes
 * en attente (status=pending) et renvoie des propositions classées
 * (automatic / proposed / to_identify). AUCUN effet de bord : la validation
 * appartient à `applyReconciliation`.
 *
 * Chaîne canonique : BankImport (lot) → BankTransaction (pending) → moteur →
 * propositions → [Valider|Modifier|Ignorer] → Transaction / Payment.
 *
 * Ordre de matching (moteur) : BankRule → virement interne → RentDue → Loan →
 * catégorie historique → catégorisation déterministe → IA (à venir) → à vérifier.
 *
 * Payload: { ids?: string[] } — optionnel : limite aux BankTransaction ids.
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
    try { body = await req.json(); } catch (_e) { /* payload optionnel */ }

    const svc = base44.asServiceRole;

    // BankTransaction brutes en attente (non liées, non ignorées).
    let bts: any[];
    if (Array.isArray(body.ids) && body.ids.length) {
      bts = [];
      for (const id of body.ids) {
        try { const bt = await svc.entities.BankTransaction.get(String(id)); if (bt) bts.push(bt); } catch (_e) { /* skip */ }
      }
      bts = bts.filter((b) => b && b.owner_id === user.email && b.status !== 'linked' && b.status !== 'ignored');
    } else {
      bts = await svc.entities.BankTransaction.filter({ owner_id: user.email, status: 'pending' }, '-created_date', 1000);
    }
    bts = (bts || []).filter((b) => b && b.status === 'pending');

    if (!bts.length) {
      return Response.json({ proposals: [], aggregate: aggregateReconcile([]), context_counts: {} });
    }

    const ctx = await loadReconcileContext(svc, user.email);

    const proposals = [];
    for (const bt of bts) {
      const account = findAccountForBt(ctx.accounts, bt);
      try {
        const p = reconcileBankTransaction(bt, { ...ctx, account, transfert_pool: bts });
        proposals.push({
          bank_transaction_id: bt.id, date: bt.date, amount: bt.amount,
          raw_description: bt.raw_description, account_id: bt.account_id, ...p,
        });
      } catch (e) {
        proposals.push({
          bank_transaction_id: bt.id, date: bt.date, amount: bt.amount, raw_description: bt.raw_description,
          type: 'unknown', level: 'to_identify', confidence: 0,
          reason: 'Erreur moteur: ' + (e as any)?.message, evidence: [], transaction_patch: null,
        });
      }
    }

    return Response.json({
      proposals,
      aggregate: aggregateReconcile(proposals),
      context_counts: {
        bank_transactions: bts.length,
        leases: ctx.leases.length,
        rent_dues_open: ctx.rent_dues.length,
        rules: ctx.rules.length,
        bank_accounts: ctx.accounts.length,
        holders: ctx.holders.length,
        loans: ctx.loans.length,
      },
    });
  } catch (error) {
    return Response.json({ error: (error as any)?.message || 'Erreur' }, { status: 500 });
  }
}