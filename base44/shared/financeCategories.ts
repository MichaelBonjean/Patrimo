/**
 * SOURCE DE VÉRITÉ UNIQUE des catégories financières.
 *
 * Une catégorie est identifiée par une CLÉ STABLE (snake_case) — jamais par son
 * libellé français. Le libellé ne sert qu'à l'affichage.
 *
 * Toute catégorie historique (libellé français) est ramenée à une clé canonique
 * via `resolveKey`. Les libellés non reconnus tombent sur la clé `other` SANS
 * perdre le libellé d'origine (conservé dans `category_label` sur Transaction).
 *
 * Chaque catégorie porte :
 *  - id            : identifiant stable (== key)
 *  - key           : clé technique snake_case (identifiant contractuel)
 *  - label         : libellé français (affichage uniquement)
 *  - direction     : 'income' | 'expense'
 *  - cashflow_group: 'operating' | 'financing' | 'transfer' | 'tax' | 'exceptional'
 *  - tax_group     : traitement fiscal (cf. taxEngine.TaxKind)
 *  - active        : exposée dans les sélecteurs UI
 */

export type Direction = 'income' | 'expense';
export type CashflowGroup = 'operating' | 'financing' | 'transfer' | 'tax' | 'exceptional';
export type TaxGroup =
  | 'revenue' | 'recoverable' | 'deposit' | 'transfer'
  | 'deductible' | 'loan' | 'amortissement' | 'non_deductible'
  | 'tax' | 'unclassified';

export interface FinanceCategory {
  id: string;
  key: string;
  label: string;
  direction: Direction;
  cashflow_group: CashflowGroup;
  tax_group: TaxGroup;
  active: boolean;
}

export const OTHER_KEY = 'other';

export const FINANCE_CATEGORIES: FinanceCategory[] = [
  // --- REVENUS ---
  { id: 'rent',             key: 'rent',             label: 'Loyer',                      direction: 'income', cashflow_group: 'operating',   tax_group: 'revenue',       active: true },
  { id: 'tenant_charges',   key: 'tenant_charges',   label: 'Charges locataire',          direction: 'income', cashflow_group: 'operating',   tax_group: 'recoverable',   active: true },
  { id: 'caf',              key: 'caf',              label: 'CAF / APL',                   direction: 'income', cashflow_group: 'operating',   tax_group: 'revenue',       active: true },
  { id: 'deposit_received', key: 'deposit_received', label: 'Dépôt de garantie reçu',    direction: 'income', cashflow_group: 'financing',  tax_group: 'deposit',       active: true },
  { id: 'vat_refund',       key: 'vat_refund',       label: 'Remboursement TVA',          direction: 'income', cashflow_group: 'tax',         tax_group: 'unclassified',  active: true },
  { id: 'other_income',     key: 'other_income',     label: 'Autres revenus',             direction: 'income', cashflow_group: 'exceptional', tax_group: 'revenue',       active: true },

  // --- CHARGES DÉDUCTIBLES (réel) ---
  { id: 'loan_installment',     key: 'loan_installment',     label: 'Échéance prêt',            direction: 'expense', cashflow_group: 'financing',  tax_group: 'loan',          active: true },
  { id: 'loan_insurance',        key: 'loan_insurance',        label: 'Assurance prêt',          direction: 'expense', cashflow_group: 'financing',  tax_group: 'deductible',    active: true },
  // Ventilation prêt (alternative à loan_installment, gérée par le financeEngine — jamais comptée 2x avec la mensualité globale)
  { id: 'loan_principal',         key: 'loan_principal',         label: 'Capital prêt',            direction: 'expense', cashflow_group: 'financing',  tax_group: 'loan',          active: true },
  { id: 'loan_interest',           key: 'loan_interest',           label: 'Intérêts prêt',          direction: 'expense', cashflow_group: 'financing',  tax_group: 'deductible',    active: true },
  { id: 'property_insurance',    key: 'property_insurance',    label: 'Assurance habitation / PNO', direction: 'expense', cashflow_group: 'operating', tax_group: 'deductible',    active: true },
  { id: 'unpaid_rent_insurance', key: 'unpaid_rent_insurance', label: 'Assurance loyers impayés', direction: 'expense', cashflow_group: 'operating', tax_group: 'deductible',    active: true },
  { id: 'property_tax',          key: 'property_tax',          label: 'Taxe foncière',           direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'cfe',                   key: 'cfe',                   label: 'CFE',                     direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'condo_fees',            key: 'condo_fees',            label: 'Charges de copropriété',  direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'management_fees',       key: 'management_fees',       label: 'Frais de gestion',        direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'accounting_fees',       key: 'accounting_fees',       label: 'Honoraires comptable',    direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'notary_fees',           key: 'notary_fees',           label: 'Frais de notaire',        direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'legal_fees',            key: 'legal_fees',            label: 'Frais juridiques',        direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'bank_fees',             key: 'bank_fees',             label: 'Frais bancaires',         direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'sci_fees',              key: 'sci_fees',              label: 'Frais de SCI',            direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'maintenance',           key: 'maintenance',           label: 'Entretien',               direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'works',                 key: 'works',                 label: 'Travaux',                 direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'supplies',              key: 'supplies',              label: 'Fournitures',             direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'electricity',           key: 'electricity',           label: 'Électricité',              direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'water',                 key: 'water',                 label: 'Eau',                     direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'gas',                   key: 'gas',                   label: 'Gaz',                     direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'internet',             key: 'internet',             label: 'Internet / Téléphone',      direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'waste',                 key: 'waste',                 label: 'Ordures ménagères',        direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'agency_fees',           key: 'agency_fees',           label: "Frais d'agence",           direction: 'expense', cashflow_group: 'operating',  tax_group: 'deductible',    active: true },
  { id: 'amortization',          key: 'amortization',          label: 'Amortissement',            direction: 'expense', cashflow_group: 'operating',  tax_group: 'amortissement', active: true },

  // --- CHARGES NON DÉDUCTIBLES / EXCEPTIONNELLES ---
  { id: 'provisions',            key: 'provisions',  label: 'Provisions',                 direction: 'expense', cashflow_group: 'exceptional', tax_group: 'non_deductible', active: true },
  { id: 'refunds',               key: 'refunds',     label: 'Remboursement',               direction: 'expense', cashflow_group: 'exceptional', tax_group: 'non_deductible', active: true },
  { id: 'deposit_refunded',      key: 'deposit_refunded', label: 'Dépôt de garantie restitué', direction: 'expense', cashflow_group: 'financing', tax_group: 'deposit',       active: true },
  { id: 'internal_transfer',     key: 'internal_transfer', label: 'Virement inter-comptes', direction: 'expense', cashflow_group: 'transfer',   tax_group: 'transfer',      active: true },
  { id: 'charge_regularization', key: 'charge_regularization', label: 'Régularisation charges', direction: 'expense', cashflow_group: 'operating', tax_group: 'recoverable',   active: true },

  // --- TAXES ---
  { id: 'tax_income', key: 'tax_income', label: 'IS / IR', direction: 'expense', cashflow_group: 'tax', tax_group: 'tax', active: true },
  { id: 'vat',        key: 'vat',        label: 'TVA',     direction: 'expense', cashflow_group: 'tax', tax_group: 'tax', active: true },

  // --- AUTRES / À QUALIFIER ---
  { id: 'other_expense', key: 'other_expense', label: 'Autres charges', direction: 'expense', cashflow_group: 'exceptional', tax_group: 'unclassified', active: true },

  // --- FALLBACK (non sélectionnable ; libellé d'origine préservé sur l'enregistrement) ---
  { id: 'other', key: 'other', label: 'À qualifier', direction: 'expense', cashflow_group: 'exceptional', tax_group: 'unclassified', active: false },
];

/** Index par clé. */
export const CATEGORY_BY_KEY: Record<string, FinanceCategory> = Object.fromEntries(
  FINANCE_CATEGORIES.map((c) => [c.key, c]),
);

/** Index par libellé canonique (affichage → clé). */
export const CATEGORY_BY_LABEL: Record<string, FinanceCategory> = Object.fromEntries(
  FINANCE_CATEGORIES.map((c) => [c.label, c]),
);

/**
 * Migration des anciens libellés techniques français → clé stable canonique.
 * Couvre : enum Transaction historique, constants/categories.js, taxEngine,
 * importFinancialData, démo. Toute valeur VIDEO du passé doit se résoudre ici.
 */
export const LEGACY_ALIASES: Record<string, string> = {
  // Revenus
  Loyer: 'rent',
  'Charges locataire': 'tenant_charges',
  'Charges locataires': 'tenant_charges',
  CAF: 'caf',
  Caution: 'deposit_received',
  'Dépôt de garantie reçu': 'deposit_received',
  'Remboursement TVA': 'vat_refund',
  'Autres revenus': 'other_income',
  // Emprunt
  'Échéance prêt': 'loan_installment',
  'Assurance prêt': 'loan_insurance',
  'Capital prêt': 'loan_principal',
  'Intérêts prêt': 'loan_interest',
  'Intérêts emprunt': 'loan_interest',
  // Assurances
  'Assurance habitation': 'property_insurance',
  'Assurance PNO': 'property_insurance',
  PNO: 'property_insurance',
  'Assurance loyers impayés': 'unpaid_rent_insurance',
  // Taxes & impôts
  'Taxe foncière': 'property_tax',
  CFE: 'cfe',
  'IS / IR': 'tax_income',
  TVA: 'vat',
  // Charges déductibles
  Copropriété: 'condo_fees',
  'Charges copropriété': 'condo_fees',
  'Frais gestion': 'management_fees',
  'Frais de gestion': 'management_fees',
  Comptable: 'accounting_fees',
  'Honoraires comptable': 'accounting_fees',
  Honoraires: 'agency_fees',
  "Frais d'agence": 'agency_fees',
  "Frais d'agence location": 'agency_fees',
  Notaire: 'notary_fees',
  'Frais de notaire': 'notary_fees',
  'Frais juridiques': 'legal_fees',
  Banque: 'bank_fees',
  'Frais bancaires': 'bank_fees',
  'Frais SCI': 'sci_fees',
  'Frais de SCI': 'sci_fees',
  Entretien: 'maintenance',
  Travaux: 'works',
  'Travaux déductibles': 'works',
  Fournitures: 'supplies',
  Électricité: 'electricity',
  Eau: 'water',
  Gaz: 'gas',
  Internet: 'internet',
  'Internet / Téléphone': 'internet',
  'Ordures ménagères': 'waste',
  Amortissement: 'amortization',
  // Non déductibles / exceptionnelles
  Provisions: 'provisions',
  Remboursement: 'refunds',
  'Dépôt de garantie restitué': 'deposit_refunded',
  'Virement interne': 'internal_transfer',
  'Virement inter-comptes': 'internal_transfer',
  'Régularisation charges': 'charge_regularization',
  // À qualifier
  'Autres charges': 'other_expense',
  'Divers charges': 'other_expense',
  Divers: 'other_expense',
  Autre: 'other_expense',
};

/**
 * Résout n'importe quelle valeur (clé canonique, libellé canonique ou alias
 * historique) en une clé stable. Retourne OTHER_KEY si inconnue.
 */
export function resolveKey(value: string | null | undefined): string {
  if (!value) return OTHER_KEY;
  const v = String(value);
  if (CATEGORY_BY_KEY[v]) return v;
  if (CATEGORY_BY_LABEL[v]) return CATEGORY_BY_LABEL[v].key;
  if (LEGACY_ALIASES[v]) return LEGACY_ALIASES[v];
  return OTHER_KEY;
}

/** Libellé français d'affichage pour une valeur (clé ou libellé legacy). */
export function labelOf(value: string | null | undefined): string {
  if (value == null || value === '') return '';
  const key = resolveKey(value);
  if (key === OTHER_KEY) return String(value); // préserve l'original
  return CATEGORY_BY_KEY[key]?.label ?? String(value);
}

/** Sens financier d'une valeur (clé ou libellé). */
export function directionOf(value: string | null | undefined): Direction | null {
  const key = resolveKey(value);
  return CATEGORY_BY_KEY[key]?.direction ?? null;
}

/** Groupe cashflow d'une clé/valeur. */
export function cashflowGroupOf(value: string | null | undefined): CashflowGroup | null {
  const key = resolveKey(value);
  return CATEGORY_BY_KEY[key]?.cashflow_group ?? null;
}

// ── BUCKET CASH-FLOW CANONIQUE (moteur financier unique) ───────────────────
// Tout écran affichant un cash-flow doit passer par ces buckets — jamais
// recompter lui-même. Cf. base44/shared/financeEngine.ts.
export type CashflowBucket = 'operating_income' | 'operating_expense' | 'debt_service' | 'excluded';

export const CASHFLOW_BUCKET_BY_KEY: Record<string, CashflowBucket> = {
  // Operating income (revenus d'exploitation)
  rent: 'operating_income',
  tenant_charges: 'operating_income',
  caf: 'operating_income',
  charge_regularization: 'operating_income',
  other_income: 'operating_income',

  // Debt service (service de la dette — traité UNE seule fois)
  loan_installment: 'debt_service',
  loan_insurance: 'debt_service',
  loan_principal: 'debt_service',
  loan_interest: 'debt_service',

  // Operating expenses (charges d'exploitation)
  property_insurance: 'operating_expense',
  unpaid_rent_insurance: 'operating_expense',
  property_tax: 'operating_expense',
  cfe: 'operating_expense',
  condo_fees: 'operating_expense',
  management_fees: 'operating_expense',
  accounting_fees: 'operating_expense',
  notary_fees: 'operating_expense',
  legal_fees: 'operating_expense',
  bank_fees: 'operating_expense',
  sci_fees: 'operating_expense',
  maintenance: 'operating_expense',
  works: 'operating_expense',
  supplies: 'operating_expense',
  electricity: 'operating_expense',
  water: 'operating_expense',
  gas: 'operating_expense',
  internet: 'operating_expense',
  waste: 'operating_expense',
  agency_fees: 'operating_expense',
  other_expense: 'operating_expense',

  // Excluded (hors cash-flow d'exploitation : bilan, fiscal, non-décaissé, neutre)
  deposit_received: 'excluded',
  deposit_refunded: 'excluded',
  vat_refund: 'excluded',
  internal_transfer: 'excluded',
  provisions: 'excluded',
  refunds: 'excluded',
  amortization: 'excluded',
  tax_income: 'excluded',
  vat: 'excluded',
  other: 'excluded',
};

/** Bucket cash-flow canonique d'une valeur (clé ou libellé). Defaut: 'excluded'. */
export function cashflowBucketOf(value: string | null | undefined): CashflowBucket {
  const key = resolveKey(value);
  return CASHFLOW_BUCKET_BY_KEY[key] ?? 'excluded';
}

/** Vrai si la valeur est une catégorie de service de la dette (prêt). */
export function isDebtService(value: string | null | undefined): boolean {
  return cashflowBucketOf(value) === 'debt_service';
}

/** Vrai si la valeur est une clé canonique connue (pas le fallback). */
export function isKnownKey(value: string | null | undefined): boolean {
  return !!value && !!CATEGORY_BY_KEY[String(value)];
}

/** Catégories actives par sens, triées par libellé. */
export function activeCategories(direction?: Direction): FinanceCategory[] {
  return FINANCE_CATEGORIES.filter((c) => c.active && (!direction || c.direction === direction));
}

/** Liste des clés actives par sens. */
export function activeKeys(direction: Direction): string[] {
  return activeCategories(direction).map((c) => c.key);
}