import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveKey, labelOf } from '../../shared/financeCategories.ts';

/**
 * Migre les catégories financières historiques (libellés français utilisés comme
 * identifiants techniques) vers les CLÉS STABLES canoniques du catalogue unique.
 *
 *  - Transaction.category        : libellé -> clé stable
 *  - Transaction.category_label  : renseigné avec le libellé français d'affichage
 *                                  (original préservé pour le fallback 'other')
 *  - BankRule.assigned_category  : libellé -> clé (pour le matching à l'import)
 *  - BankImport.assigned_category: libellé -> clé (traçabilité)
 *
 * Idempotent : ne touche pas les enregistrements déjà à la clé canonique avec label.
 * Isolé par propriétaire (owner_id) — n'opère que sur les données du propriétaire authentifié.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const owner = user.email;
    const svc = base44.asServiceRole;

    const body = await req.json().catch(() => ({}));
    const dry_run = body?.dry_run === true;

    const report = {
      owner,
      dry_run,
      transactions_total: 0,
      transactions_migrated: 0,
      transactions_kept: 0,
      transactions_other: 0,
      bankrules_migrated: 0,
      bankimports_migrated: 0,
      samples: [] as any[],
    };

    // 1) Transactions
    const txs = await svc.entities.Transaction.filter({ owner_id: owner });
    report.transactions_total = txs.length;
    const updates: any[] = [];
    for (const t of txs) {
      const key = resolveKey(t.category);
      // Idempotence : déjà une clé connue avec libellé cohérent -> on passe
      if (key !== 'other' && t.category === key && t.category_label) {
        report.transactions_kept++;
        continue;
      }
      const label = key === 'other' ? (t.category_label || t.category || 'Autre') : labelOf(key);
      if (key === 'other') report.transactions_other++;
      updates.push({ id: t.id, category: key, category_label: label });
      if (report.samples.length < 12) {
        report.samples.push({ id: t.id, before: t.category, after: key, label });
      }
    }
    report.transactions_migrated = updates.length;
    if (!dry_run && updates.length > 0) {
      const BATCH = 200;
      for (let i = 0; i < updates.length; i += BATCH) {
        await svc.entities.Transaction.bulkUpdate(updates.slice(i, i + BATCH));
      }
    }

    // 2) BankRule.assigned_category (libellé -> clé)
    const rules = await svc.entities.BankRule.filter({ owner_id: owner });
    const ruleUpdates: any[] = [];
    for (const r of rules) {
      if (!r.assigned_category) continue;
      const key = resolveKey(r.assigned_category);
      if (key === r.assigned_category) continue; // déjà une clé
      ruleUpdates.push({ id: r.id, assigned_category: key });
    }
    report.bankrules_migrated = ruleUpdates.length;
    if (!dry_run && ruleUpdates.length > 0) {
      await svc.entities.BankRule.bulkUpdate(ruleUpdates);
    }

    // 3) BankImport.assigned_category (libellé -> clé)
    const imports = await svc.entities.BankImport.filter({ owner_id: owner });
    const importUpdates: any[] = [];
    for (const b of imports) {
      if (!b.assigned_category) continue;
      const key = resolveKey(b.assigned_category);
      if (key === b.assigned_category) continue;
      importUpdates.push({ id: b.id, assigned_category: key });
    }
    report.bankimports_migrated = importUpdates.length;
    if (!dry_run && importUpdates.length > 0) {
      const BATCH = 200;
      for (let i = 0; i < importUpdates.length; i += BATCH) {
        await svc.entities.BankImport.bulkUpdate(importUpdates.slice(i, i + BATCH));
      }
    }

    return Response.json({ success: true, report });
  } catch (error) {
    console.error('migrateTransactionCategories error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
}