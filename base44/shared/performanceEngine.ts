/**
 * MOTEUR DE RENTABILITÉ CANONIQUE — source unique de vérité des KPI patrimoniaux.
 *
 * Pour un Property donné et une période donnée, Patrimo ne produit QU'UNE SEULE
 * rentabilité nette. Aucun écran / rapport / tableau ne doit recompter une
 * rentabilité : tous appellent `computePropertyPerformance` /
 * `computePortfolioPerformance` / `getPerformanceBreakdown`.
 *
 * Définitions canoniques :
 *
 *   ACQUISITION_COST  = purchase_price + notary_fees + acquisition_agency_fees
 *                       + initial_works
 *   RENTAL_INCOME     = loyer HC annuel THÉORIQUE (baux actifs), jamais l'encaissé
 *                       (l'encaissé relève du taux d'encaissement, pas du rendement)
 *   NON_RECOVERABLE_OPEX = charges d'exploitation non récupérables
 *                          (foncière, PNO, charges copro non récup., gestion,
 *                           entretien, comptabilité si retenue, autres)
 *   NOI               = RENTAL_INCOME − NON_RECOVERABLE_OPEX
 *   GROSS_YIELD       = RENTAL_INCOME / ACQUISITION_COST × 100
 *   NET_YIELD          = NOI / ACQUISITION_COST × 100     (LE CRÉDIT N'EST JAMAIS
 *                                                       SOUSTRAIT — il appartient
 *                                                       au cash-flow, pas au NOI)
 *   NET_NET_YIELD      = (NOI − taxAmount) / ACQUISITION_COST × 100
 *   THEORETICAL_CASHFLOW = NOI − debtServiceTheoretical   (financement inclus ici)
 *   ACTUAL_CASHFLOW    = net_cashflow réel (financeEngine, transactions validées)
 *   CASH_ON_CASH      = ACTUAL_CASHFLOW / investedCapital × 100
 *
 * RÈGLE D'OR : le crédit modifie cash-flow, JAMAIS netYield.
 *
 * PURE : aucun import plateforme — utilisable frontend (façade src/lib) et backend.
 */

import { computePropertyCashflow } from './financeEngine.ts';
import { getMonthlyPayment } from './loanEngine.ts';
import { buildEstimate } from './taxEngine.ts';

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: any) => (v == null || v === '' ? 0 : Number(v) || 0);

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isLeaseActiveAt(lease: any, dateISO: string): boolean {
  if (!lease.date_start || lease.date_start > dateISO) return false;
  if (lease.date_end && lease.date_end < dateISO) return false;
  return true;
}

export interface AcquisitionCost {
  total: number;
  components: {
    purchase_price: number;
    notary_fees: number;
    acquisition_agency_fees: number;
    initial_works: number;
  };
}

export interface OperatingIncome {
  rentalIncome: number;             // loyer HC annuel théorique (baux actifs)
  nonRecoverableOpEx: number;        // charges d'exploitation non récupérables
  netOperatingIncome: number;       // NOI
  opexBreakdown: Record<string, number>;
  rentalIncomeBasis: 'leases' | 'legacy_lot' | 'none';
}

export type TaxStatus = 'actual' | 'estimated' | 'incomplete';

export interface PerformanceResult {
  grossYield: number;
  netYield: number;
  netNetYield: number | null;
  tax_status: TaxStatus;
  tax_actual: number;             // impôts réellement payés et affectés (transactions tax_income)
  tax_estimated: number;          // résultat du moteur fiscal (IS calculable ; IR = 0 faute de TMI)
  afterTaxIncome: number | null;  // NOI − taxAmount (null si fiscalité incomplète)
  taxOrigin: string;              // provenance lisible de l'impôt retenu
  theoreticalCashflow: number;
  actualCashflow: number;
  cashOnCash: number;
  acquisitionCost: AcquisitionCost;
  operatingIncome: OperatingIncome;
  actual: {
    operatingIncome: number;
    operatingExpenses: number;
    debtService: number;
    netCashflow: number;
  };
  investedCapital: number;
  completeness: number;            // 0..1
  completenessFlags: string[];
  calculationDetails: Record<string, {
    formula: string;
    values: Record<string, number>;
    steps: string[];
  }>;
}

// ── Coût d'acquisition canonique ─────────────────────────────────────────────

export function computeAcquisitionCost(property: any): AcquisitionCost {
  const components = {
    purchase_price: num(property?.purchase_price),
    notary_fees: num(property?.notary_fees),
    acquisition_agency_fees: num(property?.agency_fees),
    initial_works: num(property?.initial_works),
  };
  const total = round2(
    components.purchase_price +
    components.notary_fees +
    components.acquisition_agency_fees +
    components.initial_works
  );
  return { total, components };
}

// ── Loyer HC annuel théorique (baux actifs, repli legacy lot) ─────────────────

export function theoreticalAnnualRent(
  property: any,
  lots: any[],
  leases: any[]
): { rent: number; basis: 'leases' | 'legacy_lot' | 'none' } {
  const propLots = (lots || []).filter((l) => l.property_id === property?.id);
  if (!propLots.length) return { rent: 0, basis: 'none' };
  const today = todayISO();
  let usedLease = false;
  let usedLegacy = false;
  let monthly = 0;
  for (const lot of propLots) {
    const lotLeases = (leases || []).filter((le) => le.lot_id === lot.id);
    const active = lotLeases
      .filter((le) => isLeaseActiveAt(le, today))
      .sort((a, b) => (b.date_start || '').localeCompare(a.date_start || ''))[0];
    if (active && num(active.rent_excluding_charges) > 0) {
      monthly += num(active.rent_excluding_charges);
      usedLease = true;
    } else {
      // Repli legacy lot.rent_excluding_charges (migration non couverte par un bail).
      const lr = num(lot.rent_excluding_charges);
      if (lr > 0) { monthly += lr; usedLegacy = true; }
    }
  }
  const basis = usedLease ? 'leases' : usedLegacy ? 'legacy_lot' : 'none';
  return { rent: round2(monthly * 12), basis };
}

// ── Charges d'exploitation non récupérables (champs théoriques du bien) ──────

export function nonRecoverableOpEx(
  property: any,
  opts: { includeAccountantFees?: boolean } = {}
): { total: number; breakdown: Record<string, number> } {
  const includeAccountant = opts.includeAccountantFees !== false;
  const breakdown: Record<string, number> = {
    property_tax: num(property?.property_tax),
    pno_insurance: num(property?.pno_insurance),
    condo_fees: num(property?.condo_fees),
    management_fees: num(property?.management_fees),
    ...(includeAccountant ? { accountant_fees: num(property?.accountant_fees) } : {}),
    other_annual_charges: num(property?.other_annual_charges),
  };
  // On nettoie les clés nulles pour un breakdown propre.
  for (const k of Object.keys(breakdown)) if (breakdown[k] === 0) delete breakdown[k];
  const total = round2(Object.values(breakdown).reduce((s, v) => s + v, 0));
  return { total, breakdown };
}

/** Capital investi (apport). down_payment si renseigné, sinon coût − montant emprunté. */
export function investedCapitalOf(property: any, acq: number): number {
  const dp = num(property?.down_payment);
  if (dp > 0) return round2(dp);
  return round2(Math.max(0, acq - num(property?.loan_amount)));
}

// ── API publique : rentabilité d'un bien ──────────────────────────────────────

export function computePropertyPerformance(args: {
  property: any;
  transactions?: any[];
  year?: number;
  leases?: any[];
  lots?: any[];
  taxAmount?: number;
  includeAccountantFees?: boolean;
}): PerformanceResult {
  const property = args.property || {};
  const transactions = args.transactions || [];
  const year = Number(args.year) || new Date().getFullYear();
  const leases = args.leases || [];
  const lots = args.lots || [];
  const acq = computeAcquisitionCost(property);
  const { rent: rentalIncome, basis } = theoreticalAnnualRent(property, lots, leases);
  const opex = nonRecoverableOpEx(property, { includeAccountantFees: args.includeAccountantFees });
  const noi = round2(rentalIncome - opex.total);

  const grossYield = acq.total > 0 ? round2((rentalIncome / acq.total) * 100) : 0;
  const netYield = acq.total > 0 ? round2((noi / acq.total) * 100) : 0;

  // ── Fiscalité : réelle (transactions) > estimée (moteur fiscal) > incomplète ─
  //   tax_actual    = impôts réellement payés ET correctement affectés au bien
  //                   (transactions category 'tax_income' sur l'année).
  //   tax_estimated = résultat du moteur fiscal (buildEstimate). Seul l'IS produit
  //                   un montant d'impôt calculable ; les régimes IR ne sont JAMAIS
  //                   estimés faute de TMI — on ne présente pas une estimation
  //                   comme une certitude.
  //   RÈGLE : le régime fiscal n'est JAMAIS déduit de la forme juridique ou du
  //           type de bail (SCI ≠ IR, meublé ≠ LMNP). On lit property.tax_regime
  //           tel quel ; absent/indéterminé → 'incomplete'.
  const manualTax = args.taxAmount != null ? Number(args.taxAmount) : null;
  const txTax = (transactions || []).filter(
    (t: any) => t.property_id === property.id && Number(t.year) === year
      && t.type === 'expense' && t.category === 'tax_income',
  );
  const tax_actual = round2(txTax.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0));
  let tax_estimated = 0;
  let estimateUnsupported = false;
  try {
    const est = buildEstimate({ property, transactions, year });
    tax_estimated = round2(est.tax || 0);
    estimateUnsupported = !!est.unsupported;
  } catch {
    tax_estimated = 0;
  }

  let taxAmount: number | null;
  let tax_status: TaxStatus;
  let taxOrigin: string;
  const manualTaxFinite = manualTax != null && Number.isFinite(manualTax);
  if (manualTaxFinite) {
    taxAmount = round2(manualTax as number);
    tax_status = 'actual';
    taxOrigin = 'Impôt saisi manuellement (affecté au bien).';
  } else if (tax_actual > 0) {
    taxAmount = tax_actual;
    tax_status = 'actual';
    taxOrigin = 'Impôt réellement payé, affecté au bien (transactions tax_income).';
  } else if (tax_estimated > 0) {
    taxAmount = tax_estimated;
    tax_status = 'estimated';
    taxOrigin = 'Impôt estimé par le moteur fiscal (IS). À confirmer.';
  } else {
    taxAmount = null;
    tax_status = 'incomplete';
    taxOrigin = estimateUnsupported
      ? 'Régime fiscal non géré — estimation impossible.'
      : 'Aucun impôt réellement payé ni estimable par le moteur (régime IR / non renseigné).';
  }

  const afterTaxIncome = taxAmount != null ? round2(noi - taxAmount) : null;
  const netNetYield =
    taxAmount != null && acq.total > 0 ? round2((afterTaxIncome / acq.total) * 100) : null;

  // Service de la dette théorique (capital+intérêts hors assurance) + assurance.
  const monthlyDebt = getMonthlyPayment(property);
  const monthlyIns = num(property?.monthly_insurance);
  const debtServiceTheoretical = round2((monthlyDebt + monthlyIns) * 12);
  const theoreticalCashflow = round2(noi - debtServiceTheoretical);

  // Cash-flow réel (transactions validées — financeEngine canonique).
  const cf = computePropertyCashflow(property, transactions, year);
  const actualCashflow = cf.totals.net_cashflow;

  const investedCapital = investedCapitalOf(property, acq.total);
  const cashOnCash = investedCapital > 0 ? round2((actualCashflow / investedCapital) * 100) : 0;

  // Complétude des données (transparence sur la fiabilité du chiffre).
  const flags: string[] = [];
  if (acq.components.purchase_price <= 0) flags.push('prix d’achat manquant');
  if (rentalIncome <= 0) flags.push('loyer théorique manquant (aucun bail actif)');
  if (opex.total <= 0) flags.push('charges d’exploitation non renseignées');
  if (num(property?.loan_amount) > 0 && cf.totals.debt_service.source === 'none')
    flags.push('service de la dette non constaté en transactions');
  if (tax_status === 'incomplete') flags.push('fiscalité manquante — net-nette non calculée (à compléter)');
  else if (tax_status === 'estimated') flags.push('fiscalité estimée (moteur fiscal) — à confirmer');
  const checks = [
    acq.components.purchase_price > 0,
    rentalIncome > 0,
    opex.total > 0,
    transactions.length > 0,
  ];
  const completeness = round2(checks.filter(Boolean).length / checks.length);

  const calculationDetails = {
    acquisitionCost: {
      formula: 'Achat + Notaire + Agence (acquisition) + Travaux initiaux',
      values: { ...acq.components, total: acq.total },
      steps: [
        `Achat : ${acq.components.purchase_price} €`,
        `Notaire : ${acq.components.notary_fees} €`,
        `Agence : ${acq.components.acquisition_agency_fees} €`,
        `Travaux : ${acq.components.initial_works} €`,
        `Total : ${acq.total} €`,
      ],
    },
    grossYield: {
      formula: 'Loyer HC annuel / Coût d’acquisition × 100',
      values: { rentalIncome, acquisitionCost: acq.total, grossYield },
      steps: [
        `Loyer HC annuel (théorique, ${basis}) : ${rentalIncome} €`,
        `Coût d’acquisition : ${acq.total} €`,
        `Rendement brut : ${grossYield} %`,
      ],
    },
    netYield: {
      formula: 'NOI / Coût d’acquisition × 100 — le crédit n’est JAMAIS soustrait',
      values: { rentalIncome, nonRecoverableOpEx: opex.total, noi, acquisitionCost: acq.total, netYield },
      steps: [
        `Loyer HC annuel : ${rentalIncome} €`,
        `Charges non récupérables : ${opex.total} €`,
        `NOI = ${rentalIncome} − ${opex.total} = ${noi} €`,
        `Coût d’acquisition : ${acq.total} €`,
        `Rendement net : ${netYield} %`,
      ],
    },
    netNetYield: {
      formula: '(NOI − impôt) / Coût d’acquisition × 100',
      values: {
        noi,
        taxAmount: taxAmount ?? 0,
        tax_actual,
        tax_estimated,
        afterTaxIncome: afterTaxIncome ?? 0,
        acquisitionCost: acq.total,
        netNetYield: netNetYield ?? 0,
      },
      steps: tax_status === 'incomplete'
        ? [
            taxOrigin,
            'Net-nette non calculée — complétez la fiscalité pour obtenir le rendement net-net.',
          ]
        : [
            `NOI : ${noi} €`,
            `Impôt (${tax_status === 'actual' ? 'réel' : 'estimé'}) : ${taxAmount} €`,
            `Net après impôt : ${afterTaxIncome} €`,
            `Coût d’acquisition : ${acq.total} €`,
            `Rendement net-net : ${netNetYield} %`,
          ],
    },
    theoreticalCashflow: {
      formula: 'NOI − service de la dette théorique',
      values: { noi, debtServiceTheoretical, theoreticalCashflow },
      steps: [
        `NOI : ${noi} €`,
        `Dette théorique (12 × mensualité) : ${debtServiceTheoretical} €`,
        `Cash-flow théorique : ${theoreticalCashflow} €`,
      ],
    },
    actualCashflow: {
      formula: 'Revenus réels − Charges réelles − Service de la dette réel (transactions validées)',
      values: {
        operatingIncome: cf.totals.operating_income,
        operatingExpenses: cf.totals.operating_expenses,
        debtService: cf.totals.debt_service.total,
        netCashflow: actualCashflow,
      },
      steps: [
        `Revenus d’exploitation (transactions) : ${cf.totals.operating_income} €`,
        `Charges d’exploitation : ${cf.totals.operating_expenses} €`,
        `Service de la dette : ${cf.totals.debt_service.total} €`,
        `Cash-flow réel : ${actualCashflow} €`,
      ],
    },
    cashOnCash: {
      formula: 'Cash-flow réel / Capital investi × 100',
      values: { actualCashflow, investedCapital, cashOnCash },
      steps: [
        `Cash-flow réel : ${actualCashflow} €`,
        `Capital investi (apport) : ${investedCapital} €`,
        `Cash-on-cash : ${cashOnCash} %`,
      ],
    },
  };

  return {
    grossYield,
    netYield,
    netNetYield,
    tax_status,
    tax_actual,
    tax_estimated,
    afterTaxIncome,
    taxOrigin,
    theoreticalCashflow,
    actualCashflow,
    cashOnCash,
    acquisitionCost: acq,
    operatingIncome: {
      rentalIncome,
      nonRecoverableOpEx: opex.total,
      netOperatingIncome: noi,
      opexBreakdown: opex.breakdown,
      rentalIncomeBasis: basis,
    },
    actual: {
      operatingIncome: cf.totals.operating_income,
      operatingExpenses: cf.totals.operating_expenses,
      debtService: cf.totals.debt_service.total,
      netCashflow: actualCashflow,
    },
    investedCapital,
    completeness,
    completenessFlags: flags,
    calculationDetails,
  };
}

// ── API publique : rentabilité du portefeuille (agrégation pondérée) ──────────

export function computePortfolioPerformance(args: {
  properties: any[];
  transactions?: any[];
  year?: number;
  leases?: any[];
  lots?: any[];
  shareResolver?: (propertyId: string) => number;
  taxAmountByProperty?: Record<string, number>;
  includeAccountantFees?: boolean;
}): {
  grossYield: number;
  netYield: number;
  netNetYield: number | null;
  afterTaxIncome: number | null;
  theoreticalCashflow: number;
  actualCashflow: number;
  cashOnCash: number;
  acquisitionCost: number;
  rentalIncome: number;
  nonRecoverableOpEx: number;
  noi: number;
  investedCapital: number;
  perProperty: PerformanceResult[];
  completeness: number;
  completenessFlags: string[];
} {
  const { properties = [], transactions = [], leases = [], lots = [] } = args;
  const year = Number(args.year) || new Date().getFullYear();
  const share = args.shareResolver || (() => 1);

  const perProperty = properties.map((p) =>
    computePropertyPerformance({
      property: p,
      transactions,
      year,
      leases,
      lots,
      taxAmount: args.taxAmountByProperty?.[p.id],
      includeAccountantFees: args.includeAccountantFees,
    })
  );

  let acqTotal = 0, rentTotal = 0, opexTotal = 0, noiTotal = 0;
  let debtTheoreticalTotal = 0, actualCfTotal = 0, investedTotal = 0;
  let afterTaxTotal = 0;
  let allTaxed = perProperty.length > 0;
  const flags: string[] = [];

  properties.forEach((p, i) => {
    const s = share(p.id);
    const perf = perProperty[i];
    acqTotal += perf.acquisitionCost.total * s;
    rentTotal += perf.operatingIncome.rentalIncome * s;
    opexTotal += perf.operatingIncome.nonRecoverableOpEx * s;
    noiTotal += perf.operatingIncome.netOperatingIncome * s;
    debtTheoreticalTotal += perf.theoreticalCashflow * s;
    actualCfTotal += perf.actualCashflow * s;
    investedTotal += perf.investedCapital * s;
    if (perf.afterTaxIncome != null) afterTaxTotal += perf.afterTaxIncome * s;
    else allTaxed = false;
    for (const f of perf.completenessFlags) if (!flags.includes(f)) flags.push(f);
  });

  acqTotal = round2(acqTotal);
  rentTotal = round2(rentTotal);
  opexTotal = round2(opexTotal);
  noiTotal = round2(noiTotal);
  afterTaxTotal = round2(afterTaxTotal);

  return {
    grossYield: acqTotal > 0 ? round2((rentTotal / acqTotal) * 100) : 0,
    netYield: acqTotal > 0 ? round2((noiTotal / acqTotal) * 100) : 0,
    netNetYield: acqTotal > 0 && allTaxed ? round2((afterTaxTotal / acqTotal) * 100) : null,
    afterTaxIncome: allTaxed ? afterTaxTotal : null,
    theoreticalCashflow: round2(debtTheoreticalTotal),
    actualCashflow: round2(actualCfTotal),
    cashOnCash: investedTotal > 0 ? round2((actualCfTotal / investedTotal) * 100) : 0,
    acquisitionCost: acqTotal,
    rentalIncome: rentTotal,
    nonRecoverableOpEx: opexTotal,
    noi: noiTotal,
    investedCapital: round2(investedTotal),
    perProperty,
    completeness: perProperty.length
      ? round2(perProperty.reduce((s, p) => s + p.completeness, 0) / perProperty.length)
      : 0,
    completenessFlags: flags,
  };
}

// ── Explication « Comment est calculé ce chiffre ? » ──────────────────────────

export function getPerformanceBreakdown(
  perf: PerformanceResult,
  key:
    | 'acquisitionCost' | 'grossYield' | 'netYield' | 'netNetYield'
    | 'theoreticalCashflow' | 'actualCashflow' | 'cashOnCash'
): { formula: string; values: Record<string, number>; steps: string[]; text: string } {
  const d = perf.calculationDetails[key];
  if (!d) return { formula: '', values: {}, steps: [], text: '' };
  return {
    formula: d.formula,
    values: d.values,
    steps: d.steps,
    text: `${d.formula}\n${d.steps.join('\n')}`,
  };
}