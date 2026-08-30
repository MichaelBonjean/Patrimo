/**
 * MOTEUR DES TRANSFERTS INTER-COMPTES (virements internes).
 *
 * Un virement entre deux comptes appartenant au même patrimoine/utilisateur ne
 * doit ni gonfler les revenus ni les dépenses consolidés. Au niveau consolidé,
 * l'impact cash-flow = 0 (catégorie `internal_transfer` → bucket `excluded` du
 * financeEngine). Au niveau d'un compte individuel, le flux reste visible mais
 * identifié comme transfert.
 *
 * Détection automatique d'une paire candidate :
 *   - même montant absolu (à tolérance près) ;
 *   - sens inverse (une `income` + une `expense`) ;
 *   - période proche (même mois = `high`, mois adjacent = `medium`) ;
 *   - biens/comptes distincts (un virement inter-comptes par définition) ;
 *   - transactions non déjà liées (`transfer_pair_id` vide).
 *
 * La validation peut être automatique (bulk-apply) ou manuelle (l'utilisateur
 * relie lui-même deux transactions).
 */

export interface TransferCandidate {
  out_tx_id: string;            // transaction sortante (expense, compte émetteur)
  in_tx_id: string;             // transaction entrante (income, compte destinataire)
  amount: number;
  out_period: string;           // YYYY-MM compte émetteur
  in_period: string;            // YYYY-MM compte destinataire
  period_gap: number;           // écart en mois
  amount_diff: number;
  label_match: boolean;         // libellés similaires (tokens communs)
  confidence: 'high' | 'medium' | 'low';
  matched: boolean;
  reason: string;
}

export interface DetectOptions {
  tolerance_periods?: number;   // écart de mois max (défaut 1)
  tolerance_amount?: number;    // écart de montant max (défaut 0.01)
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const abs = (n: any) => Math.abs(Number(n) || 0);

const NOISE_WORDS = new Set([
  'virement', 'vir', 'permanent', 'periode', 'du', 'de', 'la', 'le', 'les', 'pour', 'vers',
  'compte', 'cci', 'lcl', 'sg', 'banque', 'ref', 'reference', 'id', 'du', 'au', 'comte',
]);

/** Tokenise un libellé (note / raw_description) pour la comparaison de libellés. */
function tokenize(label: string): string[] {
  return String(label || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !NOISE_WORDS.has(w));
}

/** Vrai si deux libellés partagent au moins un token significatif (insensible casse/accents). */
export function labelsMatch(a: string, b: string): boolean {
  const ta = new Set(tokenize(a));
  const tb = tokenize(b);
  return tb.some((w) => ta.has(w));
}

/**
 * Détecte les paires candidates de virements inter-comptes parmi un ensemble
 * de transactions. Fonction PURE (aucun accès base) — testable isolément et
 * réutilisable côté front pour un aperçu instantané.
 */
export function detectTransferPairs(transactions: any[], opts: DetectOptions = {}): TransferCandidate[] {
  const tolerance_periods = opts.tolerance_periods ?? 1;
  const tolerance_amount = opts.tolerance_amount ?? 0.01;

  // On ne propose que des transactions non déjà liées.
  const pool = (transactions || []).filter(
    (t) => !!t.id && !t.transfer_pair_id && (t.type === 'income' || t.type === 'expense'),
  );

  const used = new Set<string>();
  const candidates: TransferCandidate[] = [];

  for (const outTx of pool) {
    if (outTx.type !== 'expense') continue;
    if (used.has(outTx.id)) continue;

    let best: any = null;
    let bestGap = Infinity;
    let bestLabel = false;

    for (const inTx of pool) {
      if (inTx.type !== 'income') continue;
      if (used.has(inTx.id)) continue;
      if (inTx.id === outTx.id) continue;
      // Comptes distincts requis : un flux au sein d'un même bien n'est pas un
      // virement inter-comptes (les deux comptes appartiennent au même patrimoine
      // — garanti par le filtrage owner_id côté backend).
      if (inTx.property_id && outTx.property_id && inTx.property_id === outTx.property_id) continue;

      const aDiff = abs(abs(inTx.amount) - abs(outTx.amount));
      if (aDiff > tolerance_amount) continue;

      const gap = Math.abs(
        (Number(inTx.year) - Number(outTx.year)) * 12 +
        (Number(inTx.month) - Number(outTx.month)),
      );
      if (gap > tolerance_periods) continue;

      const label = labelsMatch(outTx.note || outTx.category_label || '', inTx.note || inTx.category_label || '');
      // On préfère le candidat à libellé commun, puis au plus petit écart de période.
      if (gap < bestGap || (gap === bestGap && label && !bestLabel)) {
        bestGap = gap;
        bestLabel = label;
        best = inTx;
      }
    }

    if (best) {
      used.add(best.id);
      used.add(outTx.id);
      const aDiff = abs(abs(best.amount) - abs(outTx.amount));
      const samePeriod = bestGap === 0;
      const sameAmount = aDiff < 0.001;
      let confidence: 'high' | 'medium' | 'low';
      if (samePeriod && sameAmount && bestLabel) confidence = 'high';
      else if (samePeriod && sameAmount) confidence = bestLabel ? 'high' : 'medium';
      else if (samePeriod || bestLabel) confidence = 'medium';
      else confidence = 'low';
      candidates.push({
        out_tx_id: outTx.id,
        in_tx_id: best.id,
        amount: round2(abs(outTx.amount)),
        out_period: `${outTx.year}-${String(outTx.month).padStart(2, '0')}`,
        in_period: `${best.year}-${String(best.month).padStart(2, '0')}`,
        period_gap: bestGap,
        amount_diff: round2(aDiff),
        label_match: bestLabel,
        confidence,
        matched: false,
        reason: [
          samePeriod ? 'Même période' : 'Période adjacente',
          sameAmount ? 'montant identique' : 'montant proche',
          'sens opposé',
          bestLabel ? 'libellé commun' : 'libellé différent',
        ].join(' · '),
      });
    }
  }

  return candidates;
}

/**
 * Regroupe les transactions déjà liées en paires (par `transfer_pair_id`).
 * Retourne un tableau de paires { out, in } (out=expense, in=income).
 */
export function groupLinkedPairs(transactions: any[]): { out: any; in: any; method: string }[] {
  const byId = new Map((transactions || []).map((t) => [t.id, t]));
  const seen = new Set<string>();
  const pairs: { out: any; in: any; method: string }[] = [];
  for (const t of transactions || []) {
    if (!t.transfer_pair_id || seen.has(t.id)) continue;
    const other = byId.get(t.transfer_pair_id);
    if (!other) continue;
    seen.add(t.id);
    seen.add(other.id);
    const isOut = t.type === 'expense';
    pairs.push({
      out: isOut ? t : other,
      in: isOut ? other : t,
      method: (isOut ? t : other).transfer_method || (isOut ? other : t).transfer_method || 'manual',
    });
  }
  return pairs;
}