import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { labelOf } from '../../shared/financeCategories.ts';
import { detectTransferPairs } from '../../shared/transferEngine.ts';

/**
 * Gestion des VIREMENTS INTER-COMPTES (transferts internes).
 *
 * Un virement entre deux comptes d'un même patrimoine ne doit pas gonfler les
 * revenus ni les dépenses consolidés : la catégorie `internal_transfer` est
 * neutre (bucket `excluded` du financeEngine → impact cash-flow 0 en consolidé).
 *
 * Actions (champ `action` du body) :
 *   - 'detect' : renvoie les paires candidates sans rien écrire (aperçu).
 *   - 'apply'   :applique la détection (tagge les paires en `internal_transfer` + liage).
 *   - 'link'    : lie manuellement deux transactions (out_tx_id / in_tx_id).
 *   - 'unlink'  : délie une paire (efface le liage ; garde la catégorie).
 *
 * Sécurité : admin requis ; filtrage serveur par owner_id (email de l'utilisateur).
 */
export default async function (req: Request): Promise<Response> {
  try {
    const body: any = await req.json().catch(() => ({}));
    const action = body.action || 'detect';

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json(
        { error: 'Forbidden : authentification admin requise' },
        { status: 403 },
      );
    }
    const owner = user.email;
    const svc = base44.asServiceRole;

    const loadTx = () =>
      svc.entities.Transaction.filter({ owner_id: owner }, '-created_date', 8000);

    // ── DETECT ──────────────────────────────────────────────────────────
    if (action === 'detect') {
      const txs = await loadTx();
      const candidates = detectTransferPairs(txs, {
        tolerance_periods: body.tolerance_periods ?? 1,
        tolerance_amount: body.tolerance_amount ?? 0.01,
      });
      return Response.json({ ok: true, candidates, count: candidates.length });
    }

    // ── APPLY (auto-détection validée globalement) ───────────────────────
    if (action === 'apply') {
      const txs = await loadTx();
      const candidates = detectTransferPairs(txs, {
        tolerance_periods: body.tolerance_periods ?? 1,
        tolerance_amount: body.tolerance_amount ?? 0.01,
      });
      const updates: any[] = [];
      const label = labelOf('internal_transfer');
      for (const c of candidates) {
        updates.push({
          id: c.out_tx_id,
          category: 'internal_transfer',
          category_label: label,
          transfer_pair_id: c.in_tx_id,
          transfer_method: 'auto',
        });
        updates.push({
          id: c.in_tx_id,
          category: 'internal_transfer',
          category_label: label,
          transfer_pair_id: c.out_tx_id,
          transfer_method: 'auto',
        });
      }
      if (updates.length) await svc.entities.Transaction.bulkUpdate(updates);
      return Response.json({ ok: true, applied_pairs: candidates.length, updates: updates.length });
    }

    // ── LINK (manuel) ───────────────────────────────────────────────────
    if (action === 'link') {
      const { out_tx_id, in_tx_id } = body;
      if (!out_tx_id || !in_tx_id || out_tx_id === in_tx_id) {
        return Response.json({ error: 'out_tx_id et in_tx_id requis et distincts' }, { status: 400 });
      }
      const txs = await loadTx();
      const a = txs.find((t) => t.id === out_tx_id);
      const b = txs.find((t) => t.id === in_tx_id);
      if (!a || !b) return Response.json({ error: 'Transactions introuvables' }, { status: 404 });
      if (a.type === b.type) {
        return Response.json({ error: 'Les deux transactions ont le même sens (doivent être opposées)' }, { status: 400 });
      }
      if (a.property_id && b.property_id && a.property_id === b.property_id) {
        return Response.json({ error: 'Un virement inter-comptes nécessite deux comptes distincts' }, { status: 400 });
      }
      const expenseTx = a.type === 'expense' ? a : b;
      const incomeTx = a.type === 'income' ? a : b;
      const amount_diff = Math.round((Math.abs(Math.abs(expenseTx.amount) - Math.abs(incomeTx.amount)) + Number.EPSILON) * 100) / 100;
      const label = labelOf('internal_transfer');
      await svc.entities.Transaction.bulkUpdate([
        {
          id: expenseTx.id,
          category: 'internal_transfer',
          category_label: label,
          transfer_pair_id: incomeTx.id,
          transfer_method: 'manual',
        },
        {
          id: incomeTx.id,
          category: 'internal_transfer',
          category_label: label,
          transfer_pair_id: expenseTx.id,
          transfer_method: 'manual',
        },
      ]);
      return Response.json({
        ok: true,
        amount_diff,
        warning: amount_diff > 0.01 ? 'Montants différents — liage manuel conservé' : null,
      });
    }

    // ── UNLINK ──────────────────────────────────────────────────────────
    if (action === 'unlink') {
      const { transaction_id } = body;
      if (!transaction_id) return Response.json({ error: 'transaction_id requis' }, { status: 400 });
      const txs = await loadTx();
      const t = txs.find((x) => x.id === transaction_id);
      if (!t || !t.transfer_pair_id) {
        return Response.json({ error: 'Aucune paire liée à cette transaction' }, { status: 404 });
      }
      const pair = txs.find((x) => x.id === t.transfer_pair_id);
      const updates: any[] = [
        { id: t.id, transfer_pair_id: '', transfer_method: '' },
      ];
      if (pair) updates.push({ id: pair.id, transfer_pair_id: '', transfer_method: '' });
      await svc.entities.Transaction.bulkUpdate(updates);
      return Response.json({ ok: true, unlinked: updates.length });
    }

    return Response.json({ error: `action inconnue : ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}