/**
 * Plan de commit CANONIQUE (pur, testable sans SDK) — miroir de commit.js.
 *
 * RÈGLES (cahier des charges) :
 *   1. BankTransaction est toujours créée AVANT Transaction.
 *   2. La donnée bancaire brute reste immuable.
 *   3. Transaction représente l'interprétation métier.
 *   4. Ne jamais créer Transaction puis «essayer» de créer BankTransaction ensuite.
 *   5. Toute opération doit appartenir au bon patrimony_id (owner_id).
 *
 * Sortie (state-machine brute) :
 *   pending → linked   (Transaction métier créée + liée)
 *   pending → failed   (Transaction métier échouée, brute PRÉSERVÉE, jamais supprimée)
 *   pending → ignored  (doublon exact au réimport, non recréée)
 *
 * DÉDOUBLONNAGE :
 *   - provider_transaction_id si disponible ;
 *   - sinon fingerprint stable (SHA-256).
 *   Réimport du même relevé → 0 doublon créé (skip_exact).
 */

/**
 * Décide, pour une ligne validée du pipeline, l'action de commit canonique.
 *
 * @param {object} line ligne de transaction provenant de rowsToTransactions/transform,
 *                      porte `_bankImport` (raw metal) avec `fingerprint`.
 * @param {Map<string,object>} existingByFingerprint BankTransaction déjà persistées,
 *                      indexées par fingerprint.
 * @returns {{action:'create_bt_then_tx'|'skip_exact'|'skip_no_source', fingerprint?:string|null, reason?:string}}
 */
export function planLineCommit(line, existingByFingerprint = new Map()) {
  const bi = line && line._bankImport;
  const fp = (bi && (bi.fingerprint || null)) || line?.fingerprint || null;

  // Anti-doublon : fingerprint déjà présent → réimport, on ne recrée RIEN.
  if (fp && existingByFingerprint.has(fp)) {
    return {
      action: 'skip_exact',
      fingerprint: fp,
      reason: 'BankTransaction brute déjà présente (réimport → 0 doublon créé)',
    };
  }

  // Critère final : aucune Transaction financière sans source bancaire retraçable.
  // Une ligne issue d'un import bancaire (_bankImport) mais sans fingerprint n'a pas
  // de source retraçable → on refuse de créer la Transaction.
  if (bi && !fp) {
    return {
      action: 'skip_no_source',
      reason: 'Pas de fingerprint → pas de source bancaire retraçable (critère final)',
    };
  }

  // Ordre canonique : BankTransaction (brute, pending) PUIS Transaction (liée, linked).
  return {
    action: 'create_bt_then_tx',
    fingerprint: fp,
  };
}

/**
 * Construit le plan complet d'un lot.
 * @returns {{lines:Array,Skipped}},
 *   unique: lignes à créer (BankTransaction brute d'abord, puis Transaction),
 *   skipped: { exact, noSource } (doublons / sans source — jamais créées).
 */
export function planCommitBatch(lines, existingByFingerprint = new Map()) {
  const unique = [];
  let exact = 0;
  let noSource = 0;
  for (const line of lines || []) {
    const p = planLineCommit(line, existingByFingerprint);
    if (p.action === 'create_bt_then_tx') unique.push(line);
    else if (p.action === 'skip_exact') exact++;
    else if (p.action === 'skip_no_source') noSource++;
  }
  return { unique, skipped: { exact, noSource } };
}