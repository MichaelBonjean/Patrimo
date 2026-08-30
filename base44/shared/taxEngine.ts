/**
 * Moteur de SIMULATION fiscale — purement explicatif.
 *
 * Objectif commercial : ne JAMAIS présenter une fiscalité approximative comme certaine.
 * Ce moteur produit une estimation INDICATIVE, avec origine des données, détail des
 * calculs et hypothèses. Il ne réalise pas une déclaration fiscale ni un conseil.
 *
 * Principes codés et validés :
 *  - Le capital remboursé d'un prêt n'est JAMAIS déductible.
 *  - Seuls les intérêts d'emprunt sont déductibles (estimés selon l'amortissement
 *    constant du prêt saisi sur le bien ; à défaut de données de prêt, l'échéance
 *    entière est considérée NON déductible par sécurité — on n'invente pas la part
 *    d'intérêts).
 *  - Les charges récupérables sur le locataire sont neutres (hors revenu et hors
 *    charges déductibles).
 *  - Les amortissements ne sont déductibles qu'au réel BIC / LMP / IS.
 *  - En régime micro, AUCUNE charge réelle n'est déduite (abattement forfaitaire).
 *  - Les provisions, remboursements, TVA, virements internes et cautions ne sont
 *    pas déductibles.
 */

import { CATEGORY_BY_KEY, resolveKey, OTHER_KEY } from './financeCategories.ts';

export type TaxKind =
  | 'revenue' | 'recoverable' | 'deposit' | 'transfer'
  | 'deductible' | 'loan' | 'amortissement' | 'non_deductible'
  | 'tax' | 'unclassified';

export interface TaxTreatment {
  kind: TaxKind;
  taxable?: boolean; // pour les revenus
  reason: string;
}

/**
 * Traitement fiscal DÉRIVÉ du catalogue canonique (financeCategories.ts).
 * Aucune correspondance libellé français en dur ici : tout passe par resolveKey.
 */
export const REASON_BY_KEY: Record<string, string> = {
  rent: 'Loyer encaissé — revenu locatif imposable.',
  caf: 'Aide au logement (CAF) — revenu locatif imposable.',
  other_income: 'Autres revenus locatifs imposables.',
  tenant_charges: "Charges récupérées auprès du locataire — neutres fiscalement (régularisation annuelle).",
  charge_regularization: 'Régularisation de charges récupérables — neutre fiscalement.',
  deposit_received: "Dépôt de garantie — dette, pas un revenu. Non imposable à l'encaissement.",
  internal_transfer: 'Virement inter-comptes — pas un flux fiscal.',
  loan_insurance: "Assurance emprunteur déductible au réel (hors micro).",
  property_insurance: 'Assurance habitation / PNO déductible au réel.',
  unpaid_rent_insurance: 'Assurance loyers impayés déductible au réel.',
  property_tax: 'Taxe foncière déductible au réel (revenus fonciers).',
  cfe: 'CFE déductible au réel (BIC / IS).',
  condo_fees: "Charges de copropriété déductibles au réel (quote-part non récupérable).",
  management_fees: 'Frais de gestion locative déductibles au réel.',
  accounting_fees: 'Honoraires comptables déductibles au réel / IS.',
  agency_fees: "Honoraires / frais d'agence déductibles au réel.",
  notary_fees: "Frais de notaire déductibles ; les frais d'acquisition relèvent du prix de revient / amortissement.",
  legal_fees: 'Frais juridiques déductibles au réel.',
  bank_fees: 'Frais bancaires déductibles au réel.',
  sci_fees: 'Frais de SCI déductibles au réel / IS.',
  maintenance: "Entretien / petites réparations déductibles au réel.",
  works: "Travaux d'amélioration déductibles au réel ; les constructions/reconstitutions relèvent du prix de revient ou de l'amortissement — à qualifier.",
  supplies: 'Fournitures déductibles au réel.',
  electricity: 'Déductible au réel si à la charge du bailleur.',
  water: 'Déductible au réel si à la charge du bailleur.',
  gas: 'Déductible au réel si à la charge du bailleur.',
  internet: 'Déductible au réel si justifié.',
  waste: 'Ordures ménagères déductibles au réel.',
  loan_installment: "Seuls les intérêts sont déductibles. Le capital remboursé ne l'est jamais. Ventilation estimée via l'amortissement du prêt saisi.",
  amortization: "Dotation aux amortissements (LMNP réel / LMP / IS). Non admise en revenus fonciers.",
  refunds: 'Remboursement (capital / autre) — non déductible.',
  provisions: "Provision — non déductible tant que la charge n'est pas certaine.",
  deposit_refunded: "Restitution de dépôt de garantie — flux de trésorerie, non déductible du résultat.",
  vat: 'TVA — taxe non déductible du résultat foncier/BIC.',
  tax_income: "Impôt lui-même — non déductible du résultat de l'année.",
  vat_refund: "Remboursement de TVA — à qualifier. Non compté par défaut.",
  other_expense: "Catégorie à qualifier. Non comptée par défaut.",
  other: "Catégorie non répertoriée — non comptée par sécurité.",
};

export function treatmentOf(category: string): TaxTreatment {
  const key = resolveKey(category);
  const cat = CATEGORY_BY_KEY[key];
  const kind: TaxKind = (cat?.tax_group as TaxKind) || 'unclassified';
  const taxable = kind === 'revenue';
  return {
    kind,
    taxable,
    reason: REASON_BY_KEY[key]
      || (key === OTHER_KEY
        ? "Catégorie non répertoriée — non comptée par sécurité."
        : `Catégorie « ${cat?.label ?? category} » — non comptée par sécurité.`),
  };
}

/** @deprecated Utilisteur direct du catalogue. Conservé pour compat. */
export const TAX_TREATMENT: Record<string, TaxTreatment> = Object.fromEntries(
  Object.entries(CATEGORY_BY_KEY).map(([k, c]) => [c.label, { kind: c.tax_group as TaxKind, taxable: c.tax_group === 'revenue', reason: REASON_BY_KEY[k] || '' }]),
);

type RegimeKind = 'none' | 'micro' | 'reel' | 'is' | 'custom';

export interface RegimeCap {
  kind: RegimeKind;
  label: string;
  abattement?: number; // %
  allowsExpenses?: boolean;
  allowsAmortissement?: boolean;
  is?: boolean;
  ps?: boolean; // prélèvements sociaux 17,2 %
  note?: string;
}

export const REGIME_CAPS: Record<string, RegimeCap> = {
  'Résidence principale': { kind: 'none', label: 'Résidence principale', note: "Pas de revenu locatif à déclarer." },
  'Location nue (revenus fonciers)': { kind: 'reel', label: 'Régime réel foncier', allowsExpenses: true, allowsAmortissement: false, ps: true },
  'Location nue (micro-foncier)': { kind: 'micro', label: 'Micro-foncier (abattement 30 %)', abattement: 30, allowsExpenses: false, ps: true },
  'LMNP au micro-BIC': { kind: 'micro', label: 'Micro-BIC (abattement 50 %)', abattement: 50, allowsExpenses: false, ps: true },
  'LMNP au réel': { kind: 'reel', label: 'LMNP au réel', allowsExpenses: true, allowsAmortissement: true, ps: true },
  'LMP': { kind: 'reel', label: 'LMP (réel)', allowsExpenses: true, allowsAmortissement: true, ps: true },
  "SCI à l'IR": { kind: 'reel', label: "SCI à l'IR (réel foncier)", allowsExpenses: true, allowsAmortissement: false, ps: true },
  "SCI à l'IS": { kind: 'is', label: "SCI à l'IS", allowsExpenses: true, allowsAmortissement: true, is: true },
  'Pinel': { kind: 'reel', label: 'Pinel (réel foncier)', allowsExpenses: true, allowsAmortissement: false, ps: true, note: 'Réduction d\'impôt Pinel non calculée par la simulation.' },
  'Denormandie': { kind: 'reel', label: 'Denormandie (LMNP réel)', allowsExpenses: true, allowsAmortissement: true, ps: true, note: 'Réduction d\'impôt Denormandie non calculée par la simulation.' },
};

export function regimeOf(taxRegime: string): RegimeCap {
  return REGIME_CAPS[taxRegime] || { kind: 'custom', label: 'Régime non géré', note: 'Régime fiscal non géré par la simulation — aucun résultat produit.' };
}

/** Amortissement constant : mensualité hors assurance. */
export function loanMonthlyPayment(p: { loan_amount?: number; loan_rate?: number; loan_duration_years?: number }): number | null {
  const P = Number(p?.loan_amount);
  const r = Number(p?.loan_rate);
  const y = Number(p?.loan_duration_years);
  if (!P || !isFinite(P) || P <= 0) return null;
  if (!y || !isFinite(y) || y <= 0) return null;
  const mr = r > 0 ? r / 100 / 12 : 0;
  const n = y * 12;
  if (mr === 0) return P / n;
  return (P * mr * Math.pow(1 + mr, n)) / (Math.pow(1 + mr, n) - 1);
}

export function hasLoanData(p: any): boolean {
  return !!(p && Number(p.loan_amount) > 0 && Number(p.loan_duration_years) > 0 && p.loan_start_date);
}

/**
 * Calcule les intérêts ET le capital remboursés sur une année civile donnée,
 * selon l'amortissement constant du prêt saisi.
 */
export function loanSplitForYear(p: any, year: number): { interest: number; principal: number; monthlyPayment: number | null } {
  if (!hasLoanData(p)) return { interest: 0, principal: 0, monthlyPayment: null };
  const P = Number(p.loan_amount);
  const r = Number(p.loan_rate) || 0;
  const y = Number(p.loan_duration_years);
  const mr = r > 0 ? r / 100 / 12 : 0;
  const n = y * 12;
  const M = mr === 0 ? P / n : (P * mr * Math.pow(1 + mr, n)) / (Math.pow(1 + mr, n) - 1);
  const start = new Date(p.loan_start_date);
  let remaining = P;
  let interest = 0;
  let principal = 0;
  for (let k = 0; k < n; k++) {
    const d = new Date(start.getFullYear(), start.getMonth() + k, 1);
    if (d.getFullYear() > year) break;
    if (d.getFullYear() === year) {
      const i = remaining * mr;
      const cap = Math.min(remaining, M - i);
      interest += i;
      principal += cap;
    }
    remaining = Math.max(0, remaining - (M - remaining * mr));
  }
  return { interest, principal, monthlyPayment: M };
}

export const DISCLAIMER = 'Simulation indicative ne constituant pas une déclaration fiscale ni un conseil fiscal.';

export interface EstimateBucket { label: string; amount: number; sign: '+' | '-' | '=' | 'info'; }

export interface Estimate {
  regime: string;
  regimeLabel: string;
  kind: RegimeKind;
  disclaimer: string;
  lines: EstimateBucket[];          // détail du calcul (affiché en gras)
  info: EstimateBucket[];           // hors calcul (non comptés) — transparence
  revenue: number;                  // revenus imposables
  deductibleCharges: number;        // charges réellement déductibles
  interest: number;                 // intérêts estimés
  amortissement: number;            // amortissements
  nonDeductibleCharges: number;     // capital / provisions / taxes
  recoverable: number;              // charges récupérables
  unclassified: number;              // à qualifier
  totalExpensesRecorded: number;    // total des dépenses saisies (info)
  taxableBase: number;
  tax: number;                      // IS estimé si applicable
  hypotheses: string[];
  origin: string;
  unsupported: boolean;
}

export function buildEstimate(args: { property: any; transactions: any[]; year: number }): Estimate {
  const { property, transactions = [], year } = args;
  const cap = regimeOf(property?.tax_regime);
  const txs = Array.isArray(transactions) ? transactions : [];

  let revenue = 0;
  let deductibleCharges = 0;
  let amortissement = 0;
  let nonDeductibleCharges = 0;
  let recoverable = 0;
  let unclassified = 0;
  let transfers = 0;
  let deposits = 0;
  let taxes = 0;
  let loanPaid = 0;
  let totalExpensesRecorded = 0;

  for (const t of txs) {
    const tr = treatmentOf(t.category);
    const amt = Math.abs(Number(t.amount) || 0);
    if (t.type === 'income') {
      if (tr.kind === 'revenue' && tr.taxable) revenue += amt;
      else if (tr.kind === 'recoverable') recoverable += amt;
      else if (tr.kind === 'deposit') deposits += amt;
      else if (tr.kind === 'transfer') transfers += amt;
      else if (tr.kind === 'unclassified') unclassified += amt;
      continue;
    }
    // expense
    totalExpensesRecorded += amt;
    switch (tr.kind) {
      case 'loan': loanPaid += amt; break;
      case 'deductible':
        if (cap.allowsExpenses) deductibleCharges += amt;
        else nonDeductibleCharges += amt; // micro : non déductibles
        break;
      case 'amortissement':
        if (cap.allowsAmortissement) amortissement += amt;
        else nonDeductibleCharges += amt;
        break;
      case 'recoverable': recoverable += amt; break;
      case 'non_deductible': nonDeductibleCharges += amt; break;
      case 'tax': taxes += amt; break;
      case 'transfer': transfers += amt; break;
      case 'deposit': deposits += amt; break;
      case 'unclassified': unclassified += amt; break;
      default: unclassified += amt;
    }
  }

  // Intérêts estimés : seulement au réel / IS, et seulement si on a les données du prêt.
  let interest = 0;
  let principal = 0;
  let interestExplained = false;
  let loanDataMissing = false;
  if (cap.kind === 'reel' || cap.kind === 'is') {
    if (hasLoanData(property)) {
      const split = loanSplitForYear(property, year);
      interest = split.interest || 0;
      principal = split.principal || 0;
      interestExplained = true;
    } else {
      // Sans données de prêt, on ne ventile pas les intérêts : l'échéance entière
      // est laissée non déductible (NON comptée). On n'invente pas la part d'intérêts.
      loanDataMissing = true;
      // les échéances saisies rejoignent le capital rembourser (info, non déductible)
      nonDeductibleCharges += loanPaid;
      loanPaid = 0;
    }
  } else {
    // micro / none : l'échéance n'est pas déductible -> info non déductible
    nonDeductibleCharges += loanPaid;
    loanPaid = 0;
  }

  const hypotheses: string[] = [
    "Revenus imposables = loyers + aides (CAF) + autres revenus encaissés (cautions et virements internes exclus).",
    "Charges récupérables sur le locataire exclues (neutres fiscalement).",
    "Capital remboursé du prêt NON déductible (jamais compté).",
  ];
  if (cap.kind === 'reel' || cap.kind === 'is') {
    if (interestExplained) {
      hypotheses.push("Intérêts d'emprunt estimés selon l'amortissement constant du prêt saisi (hors assurances et remboursements anticipés).");
    } else {
      hypotheses.push("Intérêts non ventilables sans données de prêt — échéances non déductibles par sécurité.");
    }
  }
  if (cap.allowsAmortissement) {
    hypotheses.push("Amortissements comptabilisés (régime réel BIC / IS).");
  } else {
    hypotheses.push("Amortissements non admis (revenus fonciers / micro).");
  }
  hypotheses.push("Travaux comptés comme charges d'amélioration déductibles ; les constructions/reconstitutions relèvent du prix de revient ou de l'amortissement — à qualifier.");
  if (cap.note) hypotheses.push(cap.note);

  const deductibleTotal = deductibleCharges + interest + amortissement;
  let taxableBase = 0;
  let tax = 0;
  const lines: EstimateBucket[] = [];
  const info: EstimateBucket[] = [];

  if (cap.kind === 'none' || cap.kind === 'custom') {
    info.push({ label: 'Capital remboursé (estimé)', amount: principal, sign: 'info' });
    info.push({ label: 'Charges non déductibles', amount: nonDeductibleCharges, sign: 'info' });
    info.push({ label: 'Charges récupérables (neutres)', amount: recoverable, sign: 'info' });
    info.push({ label: 'Non ventilées (à qualifier)', amount: unclassified, sign: 'info' });
    return {
      regime: property?.tax_regime, regimeLabel: cap.label, kind: cap.kind, disclaimer: DISCLAIMER,
      lines, info, revenue, deductibleCharges, interest, amortissement,
      nonDeductibleCharges, recoverable, unclassified, totalExpensesRecorded,
      taxableBase: 0, tax: 0, hypotheses, origin: '', unsupported: cap.kind === 'custom',
    };
  }

  if (cap.kind === 'micro') {
    const abatt = cap.abattement || 0;
    taxableBase = revenue * (1 - abatt / 100);
    lines.push({ label: 'Revenus imposables', amount: revenue, sign: '+' });
    lines.push({ label: `Abattement forfaitaire ${abatt}%`, amount: revenue - taxableBase, sign: '-' });
    lines.push({ label: 'Base imposable', amount: taxableBase, sign: '=' });
    info.push({ label: 'Charges réelles non déductibles en micro', amount: deductibleCharges + nonDeductibleCharges + loanPaid, sign: 'info' });
    info.push({ label: 'Capital remboursé (estimé)', amount: principal, sign: 'info' });
    info.push({ label: 'Charges récupérables (neutres)', amount: recoverable, sign: 'info' });
    info.push({ label: 'Non ventilées (à qualifier)', amount: unclassified, sign: 'info' });
  } else {
    // reel | is
    lines.push({ label: 'Revenus imposables', amount: revenue, sign: '+' });
    lines.push({ label: 'Charges déductibles', amount: deductibleCharges, sign: '-' });
    if (interestExplained && interest > 0) lines.push({ label: 'Intérêts d\'emprunt estimés', amount: interest, sign: '-' });
    if (amortissement > 0) lines.push({ label: 'Amortissements', amount: amortissement, sign: '-' });
    taxableBase = revenue - deductibleTotal;
    lines.push({ label: cap.kind === 'is' ? 'Résultat avant IS' : 'Résultat foncier/BIC net', amount: taxableBase, sign: '=' });
    if (cap.kind === 'is') {
      tax = calcIS(Math.max(0, taxableBase));
      lines.push({ label: 'IS estimé', amount: tax, sign: 'info' });
    }
    info.push({ label: 'Capital remboursé (non déductible)', amount: principal + (loanDataMissing ? 0 : 0), sign: 'info' });
    info.push({ label: 'Charges non déductibles', amount: nonDeductibleCharges, sign: 'info' });
    info.push({ label: 'Charges récupérables (neutres)', amount: recoverable, sign: 'info' });
    info.push({ label: 'Taxes (TVA/IS-IR) non déductibles', amount: taxes, sign: 'info' });
    info.push({ label: 'Non ventilées (à qualifier)', amount: unclassified, sign: 'info' });
  }

  return {
    regime: property?.tax_regime, regimeLabel: cap.label, kind: cap.kind, disclaimer: DISCLAIMER,
    lines, info, revenue, deductibleCharges, interest, amortissement,
    nonDeductibleCharges, recoverable, unclassified, totalExpensesRecorded,
    taxableBase, tax, hypotheses,
    origin: `Données : transactions saisies pour ${property?.name || 'ce bien'} en ${year}, régime « ${property?.tax_regime || 'non défini'} », prêt saisi sur le bien.`,
    unsupported: false,
  };
}

export function calcIS(profit: number): number {
  if (profit <= 0) return 0;
  if (profit <= 42500) return profit * 0.15;
  return 42500 * 0.15 + (profit - 42500) * 0.25;
}