/**
 * APPARIEMENT COMPTE → PROPRIÉTAIRE (Holder) — moteur pur, testable sans SDK.
 *
 * Au premier import d'un relevé, Patrimo pose la question :
 *   « À qui appartient ce compte ? »
 * et propose automatiquement une structure (Holder) lorsque possible.
 * Une fois confirmé, le (BankAccount, holder_id) est mémorisé ; les imports
 * suivants ne reposent plus la question (use_existing).
 *
 * RÈGLES :
 *   1. Un compte appartient toujours à un patrimony_id (owner_id). Refuser
 *      tout rattachement vers un Holder dont owner_id != propriétaire courant
 *      (cross-patrimony REFUSÉ).
 *   2. Une opération d'un compte SCI A est analysée par défaut dans le contexte
 *      SCI A (présomption de catégorie). Le compte ne force PAS une dépense
 *      générale de structure (cabinet comptable) vers un Property précis.
 *
 * Sorties (action) :
 *   use_existing           : BankAccount déjà mémorisé pour ce compte → on réutilise.
 *   suggest_holder         : aucun BankAccount, mais un Holder unique matché → proposition.
 *   suggest_holder_ambiguous: plusieurs Holder candidats → l'utilisateur doit choisir.
 *   unknown                : aucun Holder ne ressemble → l'utilisateur doit saisir.
 *   refused_cross_patrimony: l'appariement aboutirait à un Holder d'un autre patrimony.
 */

const PUNCT = /[^a-z0-9\s]/g;

function norm(s) {
  if (s == null) return '';
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(PUNCT, ' ').replace(/\s+/g, ' ').trim();
}

function eqId(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Matche un BankAccount existant par identité de compte (déterministe).
 * Ordre : provider_account_id > iban_masked > account_masked_id > account_name exacte.
 */
export function matchExistingAccount(cand, bankAccounts = []) {
  const pid = String(cand?.provider_account_id || '').trim();
  const iban = String(cand?.iban_masked || '').trim();
  const mid = String(cand?.account_masked_id || '').trim();
  const name = norm(cand?.account_name);
  for (const acc of bankAccounts) {
    if (pid && eqId(pid, acc.provider_account_id)) return acc;
  }
  for (const acc of bankAccounts) {
    if (iban && eqId(iban, acc.iban_masked)) return acc;
  }
  for (const acc of bankAccounts) {
    if (mid && eqId(mid, acc.account_masked_id)) return acc;
  }
  for (const acc of bankAccounts) {
    if (name && norm(acc.account_name) === name) return acc;
  }
  return null;
}

/**
 * Cherche, parmi les Holders, celui dont le nom ressemble au texte du relevé
 * (en-tête « SCI BONJEAN IMMO », « Compte M. DUPONT »…).
 * @returns {{matched:Array, exact:Array}} matched = ressemble (contient), exact = même nom.
 */
// Tokens « significatifs » (longueur >= 4) : écarte le bruit (cb, vir, sci 3 lettres…)
// et garde les noms propres (bonjean, dupont, invest, immo…).
function sigTokens(s) {
  return new Set(norm(s).split(' ').filter((t) => t && t.length >= 4));
}

export function matchHolderFromStatement(statementText, holders = []) {
  const txt = norm(statementText || '');
  if (!txt) return { matched: [], exact: [] };
  const exact = holders.filter((h) => norm(h.name) && norm(h.name) === txt);
  if (exact.length) return { matched: exact, exact };
  const txtTokens = sigTokens(statementText);
  const matched = holders.filter((h) => {
    const hn = norm(h.name);
    if (!hn) return false;
    // Contenance stricte (texte ⊇ nom du holder).
    if (txt.includes(hn) || hn.includes(txt)) return true;
    // Chevauchement de tokens significatifs (ex: « RELEVE SCI BONJEAN » → « bonjean »).
    const ht = sigTokens(h.name);
    if (!ht.size || !txtTokens.size) return false;
    for (const t of ht) if (txtTokens.has(t)) return true;
    return false;
  });
  return { matched, exact: [] };
}

/**
 * Décide l'appariement d'un compte candidat vers un propriétaire (Holder).
 *
 * @param {object} cand { provider_account_id?, iban_masked?, account_masked_id?, account_name?, statement_text? }
 * @param {object} ctx { bankAccounts?:BankAccount[], holders?:Holder[], currentOwnerEmail?:string }
 * @returns {{action, account? , holder?, candidates?, reason}}
 */
export function suggestAccountOwnership(cand, ctx = {}) {
  const bankAccounts = ctx.bankAccounts || [];
  const currentOwner = ctx.currentOwnerEmail || null;
  // Les Holders candidats sont limités au patrimoine courant : un Holder d'un
  // autre patrimony ne doit JAMAIS être proposé (le cross-patrimony est refusé).
  const holders = (ctx.holders || []).filter((h) => !h.owner_id || !currentOwner || eqId(h.owner_id, currentOwner));

  // 1. BankAccount déjà mémorisé pour ce compte ?
  const existing = matchExistingAccount(cand, bankAccounts);
  if (existing) {
    // Cross-patrimony défensif : le compte mémorisé appartient-il bien au patrimoine courant ?
    if (existing.owner_id && currentOwner && !eqId(existing.owner_id, currentOwner)) {
      return { action: 'refused_cross_patrimony', reason: 'Compte mémorisé appartient à un autre patrimony' };
    }
    // Holder lié appartenant à un autre patrimony → refusé (sécurité).
    const linked = existing.holder_id ? holders.find((h) => h.id === existing.holder_id) : null;
    if (linked && linked.owner_id && currentOwner && !eqId(linked.owner_id, currentOwner)) {
      return { action: 'refused_cross_patrimony', reason: 'Holder lié au compte appartient à un autre patrimony' };
    }
    return { action: 'use_existing', account: existing, holder: linked || null };
  }

  // 2. Aucun BankAccount : propose un Holder depuis le texte du relevé.
  const { matched, exact } = matchHolderFromStatement(cand?.statement_text, holders);
  const pool = exact.length ? exact : matched;
  if (pool.length === 1) {
    const h = pool[0];
    // Cross-patrimony : le Holder suggéré doit appartenir au patrimoine courant.
    if (h.owner_id && currentOwner && !eqId(h.owner_id, currentOwner)) {
      return { action: 'refused_cross_patrimony', reason: 'Holder suggéré appartient à un autre patrimony', holder: h };
    }
    return { action: 'suggest_holder', holder: h, reason: `Ce compte semble appartenir à ${h.name}` };
  }
  if (pool.length > 1) {
    // Plusieurs SCI / détenteurs à ce nom → ambigu : l'utilisateur doit choisir.
    return { action: 'suggest_holder_ambiguous', candidates: pool, reason: 'Plusieurs structures correspondent — confirmation requise' };
  }
  return { action: 'unknown', reason: 'Aucune structure reconnue — renseignez le propriétaire du compte' };
}

/**
 * Applique la correction utilisateur : produit la forme de BankAccount à mémoriser.
 * (Création effective gérée par le commit/couche SDK.)
 * @returns {object} record BankAccount à persister (owner_id + holder_id + confirmed=true).
 */
export function applyUserCorrection(cand, chosenHolderId, ctx = {}) {
  if (!chosenHolderId) throw new Error('chosenHolderId requis (correction utilisateur)');
  const holder = (ctx.holders || []).find((h) => h.id === chosenHolderId);
  return {
    account_name: cand?.account_name || cand?.statement_text || 'Compte à nommer',
    bank_name: cand?.bank_name || '',
    iban_masked: cand?.iban_masked || '',
    account_masked_id: cand?.account_masked_id || '',
    provider_account_id: cand?.provider_account_id || '',
    currency: cand?.currency || 'EUR',
    account_type: cand?.account_type || 'checking',
    source: cand?.source || 'csv_import',
    holder_id: chosenHolderId,
    holder_type_snapshot: holder?.type || undefined,
    property_id: cand?.property_id || undefined,
    active: true,
    confirmed: true,
  };
}