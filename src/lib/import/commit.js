import { base44 } from '@/api/base44Client';
import { labelOf } from '@/lib/financeCategories';
import { normalizeDescription } from './fingerprint';
import { triggerMilestone } from '@/lib/celebrations';
import { planLineCommit } from './commitPlan';

/**
 * COMMIT CANONIQUE — chaîne unique :
 *
 *   BankImport (LOT) → BankTransaction (brute, pending, immuable)
 *                    → Transaction (métier, liée)
 *                    → BankTransaction.status = linked  (snapshot catégorie/bien/lot)
 *
 * RÈGLES (cahier des charges) :
 *   1. BankTransaction est TOUJOURS créée AVANT Transaction.
 *   2. La donnée bancaire brute reste immuable (jamais supprimée).
 *   3. Transaction représente l'interprétation métier.
 *   4. Payment (encaissement de RentDue) est géré ailleurs (rapprochement loyer).
 *   5. Ne jamais créer Transaction puis «essayer» de créer BankTransaction ensuite.
 *   6. Toute opération appartient au bon patrimony_id (owner_id / withOwner).
 *
 * STATE-MACHINE BankTransaction : pending → linked | failed | ignored.
 *   - pending : brute créée, non rattachée à une Transaction métier ;
 *   - linked  : Transaction métier créée et liée (snapshot cat/bien/lot) ;
 *   - failed  : Transaction métier échouée — brute PRÉSERVÉE (jamais supprimée) ;
 *   - ignored  : doublon exact au réimport (non recréée).
 *
 * DÉDOUBLONNAGE : provider_transaction_id si dispo, sinon fingerprint SHA-256.
 *   Réimport du même relevé → 0 doublon créé (la Transaction métier n'est pas recréée
 *   non plus : skip_exact renvoyé en count).
 *
 * Returns { created, skipped, failed }.
 */
export async function commitTransactions(transactions, ctx) {
  const withOwner = (obj = {}) => (ctx.withOwner ? ctx.withOwner(obj) : obj);

  // Base de référence : BankTransaction déjà persistées (index par fingerprint).
  let existingBT = ctx.bankTransactions;
  if (!Array.isArray(existingBT)) {
    try {
      existingBT = await base44.entities.BankTransaction.filter(withOwner(), '-created_date', 5000);
    } catch {
      existingBT = [];
    }
  }
  const byFp = new Map();
  for (const bt of existingBT) {
    if (bt && bt.fingerprint) byFp.set(bt.fingerprint, bt);
  }

  // 1. LOT BankImport (un seul batch pour tout l'appel — canonique).
  let batchId = null;
  const firstBio = (transactions || []).find((t) => t._bankImport)?._bankImport;
  const today = new Date().toISOString().slice(0, 10);
  const batch_id = firstBio?.batch_id || `batch-${Date.now()}`;
  if (transactions.length > 0) {
    try {
      const batch = await base44.entities.BankImport.create(withOwner({
        owner_id: undefined, // withOwner injecte owner_id
        patrimony_id: firstBio?.patrimony_id || undefined,
        import_date: firstBio?.raw_date || firstBio?.import_date || today,
        description: `Lot d'import — ${firstBio?.source_format || 'banque'} (${transactions.length} ligne${transactions.length > 1 ? 's' : ''})`,
        provider: firstBio?.provider || undefined,
        source_format: firstBio?.source_format || undefined,
        file_name: firstBio?.file_name || undefined,
        file_url: firstBio?.file_url || undefined,
        amount: 0, // lot canonique : le montant vit dans BankTransaction
        status: 'pending',
        batch_id,
        rows_total: transactions.length,
      }));
      batchId = batch.id;
    } catch {
      /* le lot est optionnel : on continue sans batch (les BankTransaction reçoivent le batch_id logique) */
    }
  }

  let created = 0, skipped = 0, failed = 0;

  for (const t of transactions) {
    const biData = t._bankImport;
    const clean = { ...t };
    delete clean._bankImport;

    // Décision de commit canonique (pur, testable) — idempotence au réimport.
    const plan = planLineCommit(t, byFp);
    if (plan.action === 'skip_exact' || plan.action === 'skip_no_source') {
      skipped++;
      continue;
    }

    // 2. BankTransaction BRUTE — créée EN PREMIER, status pending, immuable.
    let btId = null;
    if (biData) {
      const nd = biData.normalized_description || normalizeDescription(biData.description || '');
      try {
        const bt = await base44.entities.BankTransaction.create(withOwner({
          account_id: biData.account || '',
          bank_account_id: biData.bank_account_id || '',
          bank_import_id: batchId || undefined,
          source_import_id: batchId || biData.batch_id || undefined,
          provider_transaction_id: biData.provider_transaction_id || '',
          patrimony_id: biData.patrimony_id || undefined,
          date: biData.raw_date || biData.import_date,
          amount: biData.amount,
          currency: 'EUR',
          raw_description: biData.description || '',
          normalized_description: nd,
          fingerprint: biData.fingerprint || '',
          dedup_status: 'unique',
          status: 'pending',
          raw_data: biData.raw_data || undefined,
        }));
        btId = bt.id;
        if (biData.fingerprint) byFp.set(biData.fingerprint, bt); // évite doublon intra-lot
      } catch {
        // Échec de la brute : on NE crée PAS la Transaction (règle 5 + critère final).
        failed++;
        continue;
      }
    }

    // Mode rapprochement : on laisse la BankTransaction brute en pending pour
    // qu'elle soit traitée par la file de rapprochement (reconcileBankTransactions
    // → applyReconciliation). Aucune Transaction n'est créée ici.
    if (ctx.reconcileFirst) {
      continue;
    }

    // 3. Transaction MÉTIER — créée APRÈS la brute (interprétation catégorisée).
    let tx;
    try {
      tx = await base44.entities.Transaction.create(withOwner({
        ...clean,
        category_label: clean.category_label || labelOf(clean.category),
        bank_import_id: batchId || undefined,
      }));
      created++;
    } catch {
      // Transaction échouée : la brute reste pending → on la marque failed (PRÉSERVÉE, jamais supprimée).
      if (btId) {
        try { await base44.entities.BankTransaction.update(btId, { status: 'failed' }); }
        catch { /* brute préservée quoiqu'il arrive */ }
      }
      failed++;
      continue;
    }

    // 4. Liaison brute → métier (status linked, snapshot cat/bien/lot).
    if (btId) {
      try {
        await base44.entities.BankTransaction.update(btId, {
          status: 'linked',
          transaction_id: tx.id,
          category: clean.category,
          property_id: clean.property_id,
          lot_id: clean.lot_id || '',
        });
      } catch { /* liaison best-effort */ }
    }
  }

  // 5. Clôture du lot BankImport.
  if (batchId) {
    try {
      await base44.entities.BankImport.update(batchId, {
        status: ctx.reconcileFirst ? 'pending' : 'categorized',
        rows_total: transactions.length,
        rows_created: created,
        rows_skipped: skipped,
        rows_failed: failed,
      });
    } catch { /* best-effort */ }
  }

  ctx.queryClient?.invalidateQueries?.({ queryKey: ['bank-imports'] });
  ctx.queryClient?.invalidateQueries?.({ queryKey: ['transactions'] });
  ctx.queryClient?.invalidateQueries?.({ queryKey: ['transactions-all'] });
  ctx.queryClient?.invalidateQueries?.({ queryKey: ['bank-transactions'] });
  if (created > 0) { try { await triggerMilestone('first_import'); } catch { /* noop */ } }
  return { created, skipped, failed };
}