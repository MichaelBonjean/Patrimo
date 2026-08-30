/**
 * MOTEUR D'APPRENTISSAGE DÉTERMINISTE — Patrimo.
 *
 *   Chaque rapprochement/correction manuel de l'utilisateur est une occasion
 *   d'apprendre : si une transaction « VIR SCI MARTIN » est associée au bail
 *   Martin, on peut proposer une BankRule afin que les prochains virements
 *   similaires soient reconnus automatiquement.
 *
 *   RÈGLES DE SÉCURITÉ (anti-règle trop large) :
 *     - n'extray jamais un mot-clé trop générique (virement, loyer, charges…) ;
 *     - n'obscurcit jamais une règle existante plus précise ;
 *     - ne crée jamais silencieusement : on PROPOSE, l'utilisateur décide.
 *
 *   MOTEUR PUR : aucun accès base, aucun effet de bord. Réutilisable côté front
 *   (aperçu instantané après rapprochement) et backend.
 */

import { normalizeDescription } from './bankReconcileEngine';

// Tokens de bruit à retirer des extrémités de la séquence (verbes financiers).
const LEADING_STRIP = new Set([
  'vir', 'virement', 'virmt', 'prelevement', 'prelev', 'prlv', 'cb', 'payment',
  'paiement', 'paymt', 'du', 'de', 'la', 'le', 'les', 'des', 'a', 'au', 'et',
  'ref', 'via', 'ordre', 'emetteur',
]);

// Tokens parasites courts à ignorer.
const NOISE_TOKENS = new Set([
  'du', 'de', 'la', 'le', 'les', 'des', 'a', 'au', 'et', 'the', 'of', 'for',
  'to', 'ref', 'cpt', 'sep', 'm', 'r', 'n', 'mr', 'mme',
]);

// Mots-clés seuls trop larges : un mot-clé réduit à l'un de ceux-ci est rejeté.
const TOO_BROAD_SINGLE = new Set([
  'vir', 'virement', 'virmt', 'prelevement', 'prelev', 'prlv', 'cb', 'payment',
  'paiement', 'paymt', 'loyer', 'loyers', 'charges', 'charge', 'provision',
  'echeance', 'mensuel', 'mensualite', 'operation', 'facture', 'ref', 'banque',
  'pret', 'assurance', 'taxe', 'caf', 'copro', 'copropriete', 'fournisseur',
]);

/**
 * Extrait un mot-clé candidat (normalisé, insensible casse/accents) à partir du
 * libellé bancaire. Retourne null si le libellé est trop générique.
 *
 *   "VIR SCI MARTIN"   → "sci martin"
 *   "VIR CAF ALS"      → "caf als"
 *   "PRELEVEMENT AXA"  → "axa"
 *   "VIREMENT"         → null  (trop générique)
 */
export function extractCandidateKeyword(description) {
  const nd = normalizeDescription(description);
  if (!nd) return null;
  const toks = nd.split(' ').filter((t) => t && t.length >= 2 && !/^\d+$/.test(t) && !NOISE_TOKENS.has(t));
  if (!toks.length) return null;

  // Strip les verbes financiers en tête/queue.
  let start = 0;
  let end = toks.length;
  while (start < end && LEADING_STRIP.has(toks[start])) start++;
  while (end > start && LEADING_STRIP.has(toks[end - 1])) end--;
  if (start >= end) return null;

  let run = toks.slice(start, end);
  if (run.length > 4) run = run.slice(0, 4); // borne le mot-clé (spécificité)
  while (run.length && run[0].length < 2) run.shift();
  while (run.length && run[run.length - 1].length < 2) run.pop();
  if (!run.length) return null;

  if (run.length === 1 && TOO_BROAD_SINGLE.has(run[0])) return null;

  const keyword = run.join(' ');
  if (keyword.length < 4) return null;
  return keyword;
}

/**
 * Détecte les conflits entre le mot-clé candidat et les règles existantes.
 *
 *   duplicate         : même mot-clé (normalisé) qu'une règle existante.
 *   broader_existing  : une règle existante est plus large (son mot-clé est
 *                       inclus dans le candidat) — le candidat est plus précis.
 *   narrower_existing : une règle existante est plus précise (son mot-clé
 *                       contient le candidat) — le candidat serait trop large.
 */
export function analyzeConflicts(keyword, existingRules = []) {
  const ck = normalizeDescription(keyword);
  const conflicts = [];
  if (!ck) return conflicts;
  for (const r of existingRules) {
    if (!r || !r.keyword) continue;
    const rk = normalizeDescription(r.keyword);
    if (!rk) continue;
    if (rk === ck) {
      conflicts.push({ rule_id: r.id, rule_keyword: r.keyword, kind: 'duplicate', note: 'Une règle avec ce même mot-clé existe déjà.' });
    } else if (ck.includes(rk)) {
      conflicts.push({ rule_id: r.id, rule_keyword: r.keyword, kind: 'broader_existing', note: `Règle existante « ${r.keyword} » plus large — la nouvelle est plus précise.` });
    } else if (rk.includes(ck)) {
      conflicts.push({ rule_id: r.id, rule_keyword: r.keyword, kind: 'narrower_existing', note: `Règle existante « ${r.keyword} » plus précise — la nouvelle serait trop large.` });
    }
  }
  return conflicts;
}

/**
 * Construit la proposition de règle à partir d'un rapprochement manuel.
 *
 * @param {object} args
 *   description      : libellé bancaire de la transaction rapprochée
 *   amount          : montant signé (signe → direction)
 *   target          : { category, lease_id, property_id, lot_id } choix utilisateur
 *   existingRules   : règles BankRule existantes du propriétaire
 * @returns { candidate, conflicts, suggestion, existing_rule_id?, reason }
 *   suggestion ∈ 'create' | 'update_existing' | 'skip'
 */
export function proposeRule({ description, amount, target = {}, existingRules = [] }) {
  const keyword = extractCandidateKeyword(description);
  if (!keyword) {
    return { candidate: null, conflicts: [], suggestion: 'skip', reason: 'Libellé trop générique pour en déduire une règle fiable.' };
  }

  const conflicts = analyzeConflicts(keyword, existingRules);
  const dup = conflicts.find((c) => c.kind === 'duplicate');
  const hasNarrower = conflicts.some((c) => c.kind === 'narrower_existing');

  const direction = Number(amount) >= 0 ? 'in' : 'out';
  const candidate = {
    keyword,
    conditions: { direction },
    assigned_category: target.category || '',
    assigned_lease_id: target.lease_id || null,
    assigned_property_id: target.property_id || null,
    assigned_lot_id: target.lot_id || null,
    source: 'learned_from_validation',
    priority: 10,
    is_active: true,
  };

  if (dup) {
    return { candidate, conflicts, suggestion: 'update_existing', existing_rule_id: dup.rule_id, reason: 'Une règle identique existe déjà — remplacer sa cible ?' };
  }
  if (hasNarrower) {
    return { candidate, conflicts, suggestion: 'skip', reason: 'Une règle plus précise existe déjà — la nouvelle serait trop large.' };
  }

  // broader_existing : on crée avec une priorité supérieure aux règles plus larges.
  const broader = conflicts.filter((c) => c.kind === 'broader_existing');
  if (broader.length) {
    const broaderRules = existingRules.filter((r) => broader.some((c) => c.rule_id === r.id));
    const maxPrio = broaderRules.reduce((m, r) => Math.max(m, Number(r.priority) || 0), 0);
    candidate.priority = maxPrio + 1;
  }

  return { candidate, conflicts, suggestion: 'create', reason: 'Reconnaissance automatique proposée pour les prochains virements similaires.' };
}