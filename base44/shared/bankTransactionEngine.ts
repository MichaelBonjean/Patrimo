/**
 * MOTEUR DE DÉDOUBLONNAGE DES IMPORTS BANCAIRES (miroir backend de
 * src/lib/import/fingerprint.js).
 *
 * Une transaction bancaire brute est identifiée par un fingerprint SHA-256 :
 *   account_id | provider_transaction_id | date | amount(2dec) | normalized_description
 *
 * Trois niveaux de rapprochement :
 *   - exact    : même fingerprint → le réimport du même fichier ne recrée PAS la ligne.
 *   - probable : même compte + même montant + date ±3j + libellés similaires (ou même
 *                provider_transaction_id) → présenté à l'utilisateur pour validation.
 *   - unique   : rien de proche.
 *
 * RÈGLE ABSOLUE : deux paiements distincts partageant le même mois + catégorie + lot
 * ne doivent JAMAIS être fusionnés. Le dédoublonnage ne s'appuie que sur l'identité
 * de la ligne bancaire brute.
 */

import { createHash } from 'node:crypto';

const NOISE_TOKENS = new Set([
  'cb', 'vir', 'virement', 'virmt', 'prlv', 'prelevement', 'prelev', 'prelvt',
  'payment', 'paiement', 'paymt', 'du', 'le', 'la', 'les', 'de', 'des', 'a', 'a',
  'au', 'et', 'the', 'of', 'for', 'to', 'ref', 'facture',
]);

export function normalizeDescription(input: string | null | undefined = ''): string {
  let s = String(input ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/\d{2}[/\-.]\d{2}[/\-.]\d{2,4}/g, ' ');
  s = s.replace(/\d+/g, ' ');
  s = s.replace(/[^a-z\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.split(' ').filter((t) => t && t.length >= 2 && !NOISE_TOKENS.has(t)).join(' ');
  return s;
}

export function tokenize(s: string): Set<string> {
  return new Set((s || '').split(' ').filter(Boolean));
}

export function descriptionSimilarity(a: string, b: string): number {
  const ta = tokenize(a), tb = tokenize(b);
  if (!ta.size && !tb.size) return 1;
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter += 1; });
  return inter / Math.max(ta.size, tb.size);
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

export function isoDate(d: string | Date | null | undefined): string {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d).trim();
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return s.slice(0, 10);
}

interface FpInput {
  account_id?: string | null;
  provider_transaction_id?: string | null;
  date?: string | Date | null;
  amount?: number | string | null;
  raw_description?: string | null;
  normalized_description?: string | null;
}

function canonical(i: FpInput): string {
  const acct = String(i.account_id || '').trim().toLowerCase();
  const pid = String(i.provider_transaction_id || '').trim();
  const d = isoDate(i.date || '');
  const amt = (Number(i.amount || 0)).toFixed(2);
  const nd = normalizeDescription(i.raw_description || i.normalized_description || '');
  return [acct, pid, d, amt, nd].join('|');
}

export function makeFingerprintSync(i: FpInput): string {
  return 'sha256:' + createHash('sha256').update(canonical(i)).digest('hex');
}

export interface Candidate {
  fingerprint: string;
  account_id?: string | null;
  provider_transaction_id?: string | null;
  date?: string | Date | null;
  amount?: number | string | null;
  normalized_description?: string | null;
}

export interface ExistingBT extends Candidate {
  id?: string;
}

export function isProbableDuplicate(cand: Candidate, existing: ExistingBT): boolean {
  const ca = String(cand.account_id || '').trim().toLowerCase();
  const ea = String(existing.account_id || '').trim().toLowerCase();
  const sameAcct = ca === ea || (!ca && !ea);
  if (!sameAcct) return false;
  if (Math.abs(Math.abs(Number(cand.amount || 0)) - Math.abs(Number(existing.amount || 0))) >= 0.01) return false;
  const cp = String(cand.provider_transaction_id || '').trim();
  if (cp && cp === String(existing.provider_transaction_id || '').trim()) return true;
  const d1 = new Date(isoDate(cand.date)).getTime();
  const d2 = new Date(isoDate(existing.date)).getTime();
  if (isNaN(d1) || isNaN(d2)) return false;
  if (Math.abs(d1 - d2) / 86400000 > 3) return false;
  return descriptionSimilarity(cand.normalized_description || '', existing.normalized_description || '') >= 0.6;
}

export function classifyDuplicate(cand: Candidate, existingList: ExistingBT[] = []): { level: 'exact' | 'probable' | null; match?: ExistingBT } {
  const exact = existingList.find((bt) => bt.fingerprint === cand.fingerprint);
  if (exact) return { level: 'exact', match: exact };
  const prob = existingList.find((bt) => bt.fingerprint !== cand.fingerprint && isProbableDuplicate(cand, bt));
  if (prob) return { level: 'probable', match: prob };
  return { level: null };
}