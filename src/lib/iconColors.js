/**
 * Palette de couleurs sémantique par domaine métier.
 *
 * Centralise la couleur des icônes pour donner du sens aux éléments
 * de l'interface (navigation, onglets, cartes de stats, badges).
 *
 * Toutes les classes sont des littéraux Tailwind (purge-safe).
 */

const DOMAIN_COLORS = {
  loyers: 'text-emerald-600',
  banque: 'text-blue-700',
  biens: 'text-slate-700',
  alertes: 'text-amber-600',
  documents: 'text-purple-600',
  fiscal: 'text-indigo-600',
  equipe: 'text-cyan-600',
};

const DEFAULT_COLOR = 'text-slate-500';

/**
 * Retourne la classe Tailwind (text-*) pour un domaine métier.
 * @param {keyof typeof DOMAIN_COLORS | string} domain
 * @returns {string}
 */
export function colorForDomain(domain) {
  return DOMAIN_COLORS[domain] || DEFAULT_COLOR;
}

/**
 * Mappage domaine ↔ route de l'app (pour colorer la nav, les tabs…).
 */
export const ROUTE_DOMAIN = {
  '/': 'biens',
  '/biens': 'biens',
  '/loyers': 'loyers',
  '/import': 'documents',
  '/banque': 'banque',
  '/a-faire': 'alertes',
  '/reglages': 'documents',
};

/**
 * Mappage catégorie financière (clé canonique) → domaine métier.
 * Utilisé pour colorer les badges de catégorie de transactions.
 */
export const DOMAIN_OF_CATEGORY = {
  // Loyers / revenus locatifs
  rent: 'loyers',
  tenant_charges: 'loyers',
  caf: 'loyers',
  charge_regularization: 'loyers',
  deposit_received: 'loyers',
  other_income: 'loyers',
  // Banque / financement
  loan_installment: 'banque',
  loan_insurance: 'banque',
  bank_fees: 'banque',
  internal_transfer: 'banque',
  deposit_refunded: 'banque',
  // Fiscal
  property_tax: 'fiscal',
  cfe: 'fiscal',
  tax_income: 'fiscal',
  vat: 'fiscal',
  vat_refund: 'fiscal',
  // Équipe / structure
  sci_fees: 'equipe',
  accounting_fees: 'equipe',
  legal_fees: 'equipe',
  // Patrimoine / exploitation
  property_insurance: 'biens',
  unpaid_rent_insurance: 'alertes',
  condo_fees: 'biens',
  management_fees: 'biens',
  notary_fees: 'biens',
  agency_fees: 'biens',
  maintenance: 'biens',
  works: 'biens',
  supplies: 'biens',
  electricity: 'biens',
  water: 'biens',
  gas: 'biens',
  internet: 'biens',
  waste: 'biens',
  amortization: 'biens',
  provisions: 'biens',
  refunds: 'biens',
  other_expense: 'biens',
  other: 'biens',
};

/**
 * Classe Tailwind (text-*) pour une catégorie financière (clé canonique ou libellé legacy).
 * @param {string} keyOrLabel
 * @returns {string}
 */
export function colorForCategoryKey(keyOrLabel) {
  const fcat = CATEGORY_RESOLVER?.(keyOrLabel);
  const domain = DOMAIN_OF_CATEGORY[fcat || keyOrLabel] || 'biens';
  return colorForDomain(domain);
}

// Injecté depuis financeCategories pour résoudre les libellés legacy (évite import circulaire).
let CATEGORY_RESOLVER = null;
export function _bindCategoryResolver(fn) {
  CATEGORY_RESOLVER = fn;
}

export default colorForDomain;