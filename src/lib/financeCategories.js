/**
 * Façade frontend du catalogue canonique (base44/shared/financeCategories.ts).
 * Source de vérité unique pour toutes les catégories financières de l'UI.
 *
 * Les composants utilisent exclusivement des CLÉS (category.key) ; les libellés
 * français ne servent qu'à l'affichage (labelOf / txCategoryLabel).
 */
export {
  FINANCE_CATEGORIES,
  CATEGORY_BY_KEY,
  CATEGORY_BY_LABEL,
  LEGACY_ALIASES,
  OTHER_KEY,
  resolveKey,
  labelOf,
  directionOf,
  cashflowGroupOf,
  isKnownKey,
  activeCategories,
  activeKeys,
} from '../../base44/shared/financeCategories.ts';

import {
  FINANCE_CATEGORIES as _ALL,
  resolveKey as _resolveKey,
  labelOf as _labelOf,
  directionOf as _directionOf,
} from '../../base44/shared/financeCategories.ts';

/** Libellé d'affichage d'une transaction (préserve le libellé d'origine si fallback). */
export function txCategoryLabel(tx) {
  if (!tx) return '';
  if (tx.category_label) return tx.category_label;
  return _labelOf(tx.category);
}

/** Clé canonique d'une transaction (résout aussi les libellés legacy stockés). */
export function txCategoryKey(tx) {
  return tx ? _resolveKey(tx.category) : 'other';
}

/** Sens d'une transaction via sa catégorie (fallback vers tx.type). */
export function txDirection(tx) {
  const d = tx ? _directionOf(tx.category) : null;
  return d || (tx ? tx.type : null);
}

/* ---------------- Compatibilité avec l'ancien `@/constants/categories` ---------------- */
/* Les consommateurs historiques importent TRANSACTION_CATEGORIES / INCOME_CATEGORIES /
 * EXPENSE_CATEGORIES / getCategoryType. On les fournit dorénavant en CLÉS stables. */

export const TRANSACTION_CATEGORIES = _ALL
  .filter((c) => c.active)
  .map((c) => ({ value: c.key, type: c.direction, label: c.label }));

export const INCOME_CATEGORIES = TRANSACTION_CATEGORIES
  .filter((c) => c.type === 'income')
  .map((c) => c.value);

export const EXPENSE_CATEGORIES = TRANSACTION_CATEGORIES
  .filter((c) => c.type === 'expense')
  .map((c) => c.value);

export const getCategoryType = (category) => {
  const d = _directionOf(category);
  return d || 'expense';
};