/**
 * Dédoublonnage des imports bancaires basé sur un fingerprint stable (SHA-256).
 *
 * RÈGLE FONDAMENTALE : deux lignes ne sont JAMAIS fusionnées parce qu'elles
 * partagent le même mois / catégorie / lot. Elles peuvent représenter deux
 * paiements distincts. Le rapprochement se fait sur l'identité de la ligne
 * bancaire brute (compte + date + montant + libellé normalisé + provider_id).
 *
 * Trois niveaux :
 *   - exact    : même fingerprint → la ligne n'est PAS recréée au réimport.
 *   - probable : même compte + même montant + date proche + libellés similaires
 *                (ou même provider_transaction_id) → présenté à l'utilisateur.
 *   - unique   : rien de proche.
 *
 * Le fingerprint est SHA-256 sur la chaîne canonique :
 *   account_id | provider_transaction_id | date | amount(2dec) | normalized_description
 *
 * (version frontend — crypto.subtle ; miroir de base44/shared/bankTransactionEngine.ts)
 */

const NOISE_TOKENS = new Set([
  'cb', 'vir', 'virement', 'virmt', 'prlv', 'prelevement', 'prelev', 'prelvt',
  'payment', 'paiement', 'paymt', 'du', 'le', 'la', 'les', 'de', 'des', 'a', 'a',
  'au', 'et', 'the', 'of', 'for', 'to', 'ref', 'facture',
]);

export function normalizeDescription(input = '') {
  let s = String(input ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/\d{2}[/\-.]\d{2}[/\-.]\d{2,4}/g, ' '); // dates
  s = s.replace(/\d+/g, ' ');                            // tte séquence de chiffres (réfs/cartes/années)
  s = s.replace(/[^a-z\s]/g, ' ');                      // ponctuation -> espace
  s = s.replace(/\s+/g, ' ').trim();
  s = s.split(' ').filter((t) => t && t.length >= 2 && !NOISE_TOKENS.has(t)).join(' ');
  return s;
}

export function tokenize(s) {
  return new Set((s || '').split(' ').filter(Boolean));
}

export function descriptionSimilarity(a, b) {
  const ta = tokenize(a), tb = tokenize(b);
  if (!ta.size && !tb.size) return 1;
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter += 1; });
  return inter / Math.max(ta.size, tb.size); // coefficient de recouvrement
}

function pad(n) { return String(n).padStart(2, '0'); }

/** Retourne une date ISO YYYY-MM-DD utilisée par le fingerprint. */
export function isoDate(d) {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d).trim();
  // dd/mm/yyyy ou dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return s.slice(0, 10);
}

function canonical({ account_id, provider_transaction_id, date, amount, normalized_description }) {
  const acct = String(account_id || '').trim().toLowerCase();
  const pid = String(provider_transaction_id || '').trim();
  const d = isoDate(date);
  const amt = (Number(amount) || 0).toFixed(2);
  return [acct, pid, d, amt, normalized_description].join('|');
}

async function sha256Hex(str) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback cyrb53 (crypto.subtle indisponible)
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export async function makeFingerprint(input) {
  const nd = normalizeDescription(input.raw_description || input.normalized_description || input.description || '');
  return 'sha256:' + (await sha256Hex(canonical({
    account_id: input.account_id,
    provider_transaction_id: input.provider_transaction_id,
    date: input.date,
    amount: input.amount,
    normalized_description: nd,
  })));
}

export function isProbableDuplicate(cand, existing) {
  const ca = String(cand.account_id || '').trim().toLowerCase();
  const ea = String(existing.account_id || '').trim().toLowerCase();
  const sameAcct = ca === ea || (!ca && !ea);
  if (!sameAcct) return false;
  if (Math.abs(Math.abs(Number(cand.amount)) - Math.abs(Number(existing.amount))) >= 0.01) return false;
  const cp = String(cand.provider_transaction_id || '').trim();
  if (cp && cp === String(existing.provider_transaction_id || '').trim()) return true;
  const d1 = new Date(isoDate(cand.date)).getTime();
  const d2 = new Date(isoDate(existing.date)).getTime();
  if (isNaN(d1) || isNaN(d2)) return false;
  if (Math.abs(d1 - d2) / 86400000 > 3) return false;
  return descriptionSimilarity(cand.normalized_description, existing.normalized_description) >= 0.6;
}

/**
 * Classe une ligne candidate contre la base des BankTransaction existantes.
 * @returns {{level:'exact'|'probable'|null, match?:object}}
 */
export function classifyDuplicate(cand, existingList = []) {
  const exact = existingList.find((bt) => bt.fingerprint === cand.fingerprint);
  if (exact) return { level: 'exact', match: exact };
  const prob = existingList.find((bt) => bt.fingerprint !== cand.fingerprint && isProbableDuplicate(cand, bt));
  if (prob) return { level: 'probable', match: prob };
  return { level: null };
}