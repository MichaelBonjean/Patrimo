/**
 * MOTEUR D'AFFECTATION FINANCIÈRE — modèle d'allocation cohérent.
 *
 * Une opération bancaire ne concerne pas toujours un logement. Patrimo distingue :
 *   - dépense d'un Property   → property_id
 *   - dépense d'un Lot         → lot_id (+ property_id)
 *   - dépense d'une structure  → holder_id (SCI/SARL…) SANS property_id forcé
 *   - dépense d'un Loan        → loan_id (mensualité)
 *   - fiscalité                → tax_scope
 *   - virement interne         → transfer_pair_id (impact consolidé = 0)
 *   - dépense non affectée     → aucun target (refusée à la validation)
 *
 * VENTILATION — une dépense de STRUCTURE (holder_id, sans property_id) peut être
 * ventilée vers plusieurs biens pour l'ANALYSE (égalitaire / proportionnelle /
 * manuelle). La Transaction source reste INTACTE : la ventilation vit dans des
 * enregistrements TransactionAllocation séparés. La ventilation ne déforme
 * jamais la transaction bancaire.
 *
 * Fonctions PURES (testables isolément, réutilisables côté front et back).
 */

import { resolveKey, cashflowBucketOf } from './financeCategories.ts';

export type AllocationType =
  | 'property' | 'lot' | 'holder' | 'loan' | 'tax' | 'internal_transfer' | 'unallocated';

export type VentilationMethod = 'equal' | 'proportional' | 'manual';
export type AllocationTarget = 'property' | 'lot' | 'holder' | 'loan';
export type TaxScope = 'is' | 'ir' | 'tva' | 'other';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const abs = (n: any) => Math.abs(Number(n) || 0);

const TAX_CATEGORY_KEYS = new Set(['tax_income', 'vat']);

export interface VentilationInput {
  source_amount: number;                 // montant absolu de la transaction source
  method: VentilationMethod;
  targets: VentilationTarget[];
}

export interface VentilationTarget {
  target_type: AllocationTarget;
  target_id: string;
  weight?: number;       // proportional
  amount?: number;       // manual (fixe le montant)
  percent?: number;       // manual (fixe le %)
}

export interface AllocationLine {
  source_transaction_id?: string;
  target_type: AllocationTarget;
  target_id: string;
  amount: number;
  percent: number;
  method: VentilationMethod;
  weight?: number;
}

export interface VentilationResult {
  allocations: AllocationLine[];
  sum: number;
  diff: number;          // sum - source_amount
  ok: boolean;
  error?: string;
}

/**
 * Calcule les lignes de ventilation d'une dépense source vers N cibles.
 * Ne touche pas à la source : renvoie uniquement les AllocationLine à persister.
 *
 * - equal         : répartition égale (le reste va au dernier pour absorber l'arrondi).
 * - proportional  : selon `weight` de chaque cible.
 * - manual        : utilise `amount` ou `percent` fourni sur chaque cible.
 */
export function computeVentilation(input: VentilationInput): VentilationResult {
  const source = round2(abs(input.source_amount));
  const targets = (input.targets || []).filter((t) => !!t.target_id);
  if (source <= 0) return { allocations: [], sum: 0, diff: 0, ok: false, error: 'Montant source nul' };
  if (targets.length === 0) return { allocations: [], sum: 0, diff: source, ok: false, error: 'Aucune cible' };

  const method: VentilationMethod = input.method || 'equal';
  const lines: AllocationLine[] = [];

  if (method === 'equal') {
    const base = Math.floor(source * 100 / targets.length) / 100;
    let acc = 0;
    for (let i = 0; i < targets.length; i++) {
      const isLast = i === targets.length - 1;
      const amount = isLast ? round2(source - acc) : base;
      acc = round2(acc + amount);
      lines.push({
        target_type: targets[i].target_type,
        target_id: targets[i].target_id,
        amount,
        percent: round2((amount / source) * 100),
        method,
      });
    }
  } else if (method === 'proportional') {
    const weights = targets.map((t) => abs(t.weight));
    let totalW = weights.reduce((s, w) => s + w, 0);
    if (totalW <= 0) {
      // aucun poids → fallback égalitaire
      return computeVentilation({ source_amount: source, method: 'equal', targets });
    }
    let acc = 0;
    for (let i = 0; i < targets.length; i++) {
      const isLast = i === targets.length - 1;
      const amount = isLast ? round2(source - acc) : round2((weights[i] / totalW) * source);
      acc = round2(acc + amount);
      lines.push({
        target_type: targets[i].target_type,
        target_id: targets[i].target_id,
        amount,
        percent: round2((amount / source) * 100),
        method,
        weight: weights[i],
      });
    }
  } else {
    // manual
    let acc = 0;
    for (const t of targets) {
      let amount = 0;
      if (t.amount != null) amount = round2(abs(t.amount));
      else if (t.percent != null) amount = round2((abs(t.percent) / 100) * source);
      acc = round2(acc + amount);
      lines.push({
        target_type: t.target_type,
        target_id: t.target_id,
        amount,
        percent: round2((amount / source) * 100),
        method,
      });
    }
  }

  const sum = round2(lines.reduce((s, l) => s + l.amount, 0));
  const diff = round2(sum - source);
  const ok = Math.abs(diff) < 0.02;
  return {
    allocations: lines,
    sum,
    diff,
    ok,
    error: ok ? undefined : (diff > 0 ? 'Ventilation supérieure au montant source' : 'Ventilation incomplète'),
  };
}

/** Valide qu'un ensemble d'allocations persistées couvre bien le montant source. */
export function validateVentilation(
  allocations: AllocationLine[],
  source_amount: number
): { ok: boolean; sum: number; diff: number } {
  const sum = round2((allocations || []).reduce((s, a) => s + abs(a.amount), 0));
  const diff = round2(sum - round2(abs(source_amount)));
  return { ok: Math.abs(diff) < 0.02 && sum > 0, sum, diff };
}

/**
 * Dérive le type d'affectation d'une transaction à partir de ses champs.
 * Ordre de priorité cohérent avec le cahier des charges.
 */
export function resolveAllocationType(tx: any): AllocationType {
  if (!tx) return 'unallocated';
  if (tx.transfer_pair_id || resolveKey(tx.category) === 'internal_transfer') return 'internal_transfer';
  if (tx.tax_scope || TAX_CATEGORY_KEYS.has(resolveKey(tx.category))) return 'tax';
  if (tx.loan_id || cashflowBucketOf(resolveKey(tx.category)) === 'debt_service') return 'loan';
  if (tx.holder_id && !tx.property_id) return 'holder';
  if (tx.lot_id) return 'lot';
  if (tx.property_id) return 'property';
  return 'unallocated';
}

/**
 * Vrai si une dépense porte au moins une affectation valide (bien, lot, structure,
 * prêt ou périmètre fiscal). Une dépense « non affectée » est refusée à la validation.
 */
export function hasValidAllocation(tx: any): boolean {
  return resolveAllocationType(tx) !== 'unallocated';
}

/**
 * Vue d'ANALYSE : attribue les montants aux biens en combinant :
 *   - transactions directement affectées à un property_id ;
 *   - ventilations (TransactionAllocation) des dépenses de structure vers des biens.
 *
 * La transaction bancaire n'est PAS modifiée — seul le résultat d'analyse l'est.
 * `lotToProperty` mappe un lot vers son property_id (optionnel).
 */
export function attributeAllocations(
  transactions: any[],
  allocations: AllocationLine[] = [],
  lotToProperty: Record<string, string> = {}
): Record<string, { income: number; expense: number }> {
  const byProp: Record<string, { income: number; expense: number }> = {};
  const add = (pid: string, type: string, amount: number) => {
    if (!pid || amount <= 0) return;
    byProp[pid] = byProp[pid] || { income: 0, expense: 0 };
    byProp[pid][type === 'income' ? 'income' : 'expense'] = round2(byProp[pid][type === 'income' ? 'income' : 'expense'] + amount);
  };

  const allocsBySource = new Map<string, AllocationLine[]>();
  for (const a of allocations || []) {
    if (!a.source_transaction_id) continue;
    const arr = allocsBySource.get(a.source_transaction_id) || [];
    arr.push(a);
    allocsBySource.set(a.source_transaction_id, arr);
  }

  for (const t of transactions || []) {
    const type = t.type === 'income' ? 'income' : 'expense';
    const amt = abs(t.amount);
    if (amt <= 0) continue;
    const key = resolveKey(t.category);
    const bucket = cashflowBucketOf(key);
    // Fiscalité & virements internes : jamais attribués à un bien (impact 0 / exclu).
    if (bucket === 'excluded' && (key === 'internal_transfer' || key === 'tax_income' || key === 'vat')) continue;

    const lines = allocsBySource.get(t.id);
    if (lines && lines.length) {
      // Ventilation explicite → on suit les cibles.
      for (const l of lines) {
        if (l.target_type === 'property') add(l.target_id, type, abs(l.amount));
        else if (l.target_type === 'lot') add(lotToProperty[l.target_id] || '', type, abs(l.amount));
      }
      continue;
    }
    // Pas de ventilation : affectation directe.
    if (t.property_id) add(t.property_id, type, amt);
    else if (t.lot_id && lotToProperty[t.lot_id]) add(lotToProperty[t.lot_id], type, amt);
    // holder_id / loan_id / tax_scope non attribués à un bien (structure/prêt → hors périmètre bien).
  }

  return byProp;
}

/**
 * Impact consolidé des virements internes : doit être 0 (une sortie + une entrée
 * de même montant s'annulent). Vérifie que chaque paire liée est équilibrée.
 * Ne compte jamais l'entrée comme revenu ni la sortie comme dépense.
 */
export function consolidatedTransferNet(
  transactions: any[]
): { net: number; pairs: number; unpaired: number; ok: boolean } {
  const txs = (transactions || []).filter((t) => resolveKey(t.category) === 'internal_transfer');
  let net = 0;
  let pairs = 0;
  let unpaired = 0;
  const seen = new Set<string>();
  for (const t of txs) {
    const signed = t.type === 'income' ? abs(t.amount) : -abs(t.amount);
    net = round2(net + signed);
    if (t.transfer_pair_id) {
      if (!seen.has(t.id) && !seen.has(t.transfer_pair_id)) pairs++;
      seen.add(t.id);
      seen.add(t.transfer_pair_id);
    } else {
      unpaired++;
    }
  }
  return { net: round2(net), pairs, unpaired, ok: Math.abs(round2(net)) < 0.02 };
}

/**
 * Génère l'enum allocation_type à persister sur la Transaction lors de sa
 * création/validation (cohérence avec resolveAllocationType).
 */
export function deriveAllocationType(tx: any): AllocationType {
  return resolveAllocationType(tx);
}