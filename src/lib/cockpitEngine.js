/**
 * MOTEUR DU COCKPIT INVESTISSEUR — consolide les KPI du portefeuille immobilier.
 *
 * Source de vérité : financeEngine (cash-flow), loanEngine (CRD),
 * ownership (parts de détention), lease (loyers effectifs). Aucun recomptage.
 *
 * Chaque KPI est traçable : `kpiDetails` fournit la décomposition par bien
 * destinée au dialog de détail (BreakdownDetails). Aucun chiffre opaque.
 */
import { computePropertyCashflow } from '@/lib/financeEngine';
import { calcCurrentCRD } from '@/lib/propertyFinance';
import {
  calcTotalAcquisition, formatCurrency, formatPercent,
} from '@/lib/formatters';
import { resolveKey } from '@/lib/financeCategories';
import { effectiveRent, todayISO } from '@/lib/lease';
import { computePropertyShare } from '@/lib/ownership';
import { computePropertyPerformance } from '@/lib/performanceEngine';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function shareFn(selectedHolderId, allHolders, allMembers, allLinks) {
  if (selectedHolderId === 'all') return () => 1;
  if (!allHolders.find((h) => h.id === selectedHolderId)) return () => 1;
  return (propertyId) =>
    computePropertyShare({ personId: selectedHolderId, propertyId, members: allMembers, propertyHolders: allLinks });
}

/**
 * @returns { kpis, kpiDetails, actions, filteredProperties, filteredLots, filteredLeases }
 */
export function computeCockpit({
  properties = [], lots = [], leases = [], transactions = [], impayes = [],
  bankTxPending = [], quittances = [],
  allLinks = [], allHolders = [], allMembers = [],
  selectedHolderId = 'all', structureFilter = 'all', propertyFilter = 'all',
  year,
}) {
  const today = todayISO();
  const getShare = shareFn(selectedHolderId, allHolders, allMembers, allLinks);

  // ── Filtrage portefeuille ──
  let filtered = properties.filter((p) => {
    if (structureFilter !== 'all' && p.holding_structure !== structureFilter) return false;
    if (propertyFilter !== 'all' && p.id !== propertyFilter) return false;
    return true;
  });
  filtered = filtered.filter((p) => getShare(p.id) > 0);

  const propIds = new Set(filtered.map((p) => p.id));
  const filteredLots = lots.filter((l) => propIds.has(l.property_id));
  const filteredLeases = leases.filter((l) => propIds.has(l.property_id));
  const propName = (pid) => properties.find((p) => p.id === pid)?.name || '—';

  const k = {
    estimatedValue: 0, acquisitionCost: 0, crd: 0, equity: 0, ltv: 0,
    rentalIncome12m: 0, charges: 0, debtService: 0, cashflow: 0,
    grossYield: 0, netYield: 0, cashOnCash: 0,
    encaissementRate: 0, totalImpaye: 0, occupationRate: 0,
  };
  const items = {
    estimatedValue: [], acquisitionCost: [], crd: [], equity: [],
    rentalIncome: [], charges: [], debtService: [], cashflow: [],
    encaissement: [], ltv: [], grossYield: [], netYield: [],
    cashOnCash: [], occupation: [],
  };

  let investedCapital = 0;
  let expectedRentAnnual = 0;
  let collectedRentAnnual = 0;
  let occupiedLots = 0;
  let totalLots = 0;
  // Agrégats rentabilité canonique (performanceEngine) — le crédit N'EST PAS soustrait du NOI.
  let yieldRent = 0, yieldNoi = 0, yieldAcq = 0;

  for (const p of filtered) {
    const share = getShare(p.id);
    const acq = calcTotalAcquisition(p);
    const est = p.estimated_value || acq;
    const crd = calcCurrentCRD(p);
    const inv = p.down_payment && p.down_payment > 0 ? p.down_payment : Math.max(0, acq - (p.loan_amount || 0));

    k.estimatedValue += est * share;
    k.acquisitionCost += acq * share;
    k.crd += crd * share;
    k.equity += (est - crd) * share;
    investedCapital += inv * share;

    const txOfP = transactions.filter((t) => t.property_id === p.id && Number(t.year) === Number(year));
    const cf = computePropertyCashflow(p, txOfP, year).totals;
    // Rentabilité canonique (moteur unique) — loyer théorique + charges non récupérables, crédit exclu du NOI.
    const perf = computePropertyPerformance({ property: p, transactions: txOfP, year, lots, leases });
    yieldRent += perf.operatingIncome.rentalIncome * share;
    yieldNoi += perf.operatingIncome.netOperatingIncome * share;
    yieldAcq += perf.acquisitionCost.total * share;
    const oi = cf.operating_income * share;
    const oe = cf.operating_expenses * share;
    const ds = cf.debt_service.total * share;
    const nc = cf.net_cashflow * share;
    k.rentalIncome12m += oi;
    k.charges += oe;
    k.debtService += ds;
    k.cashflow += nc;

    // Encaissement (loyers attendus vs encaissés)
    const propLots = lots.filter((l) => l.property_id === p.id);
    const propLeases = leases.filter((l) => l.property_id === p.id);
    const expected = propLots.reduce((s, l) => s + effectiveRent(l, propLeases) * 12, 0) * share;
    const collected = txOfP
      .filter((t) => resolveKey(t.category) === 'rent' && t.type === 'income')
      .reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0) * share;
    expectedRentAnnual += expected;
    collectedRentAnnual += collected;

    const occupied = propLots.filter((l) => !l.is_vacant).length;
    totalLots += propLots.length;
    occupiedLots += occupied;

    items.estimatedValue.push({ property: p, share, value: est * share, breakdown: [!p.estimated_value ? '⚠ Estimation non définie — prix de revient utilisé' : null, share < 1 ? `Part ${formatPercent(share * 100)}` : null].filter(Boolean) });
    items.acquisitionCost.push({ property: p, share, value: acq * share, breakdown: [`Achat ${formatCurrency(p.purchase_price || 0)}`, `Notaire ${formatCurrency(p.notary_fees || 0)}`, `Agence ${formatCurrency(p.agency_fees || 0)}`, `Travaux ${formatCurrency(p.initial_works || 0)}`] });
    items.crd.push({ property: p, share, value: crd * share, breakdown: [share < 1 ? `Part ${formatPercent(share * 100)}` : null].filter(Boolean) });
    items.equity.push({ property: p, share, value: (est - crd) * share, breakdown: [`Valeur estimée ${formatCurrency(est)}`, `CRD −${formatCurrency(crd)}`] });
    items.rentalIncome.push({ property: p, share, value: oi, breakdown: [`Revenus d'exploitation ${formatCurrency(cf.operating_income)}`] });
    items.charges.push({ property: p, share, value: oe, breakdown: [`Charges d'exploitation ${formatCurrency(cf.operating_expenses)}`] });
    items.debtService.push({ property: p, share, value: ds, breakdown: [`Capital ${formatCurrency(cf.debt_service.capital)}`, `Intérêts ${formatCurrency(cf.debt_service.interest)}`, `Assurance ${formatCurrency(cf.debt_service.insurance)}`] });
    items.cashflow.push({ property: p, share, value: nc, breakdown: [`Revenus ${formatCurrency(cf.operating_income)}`, `Charges −${formatCurrency(cf.operating_expenses)}`, `Dette −${formatCurrency(cf.debt_service.total)}`] });
    items.encaissement.push({ property: p, share, value: collected, breakdown: [`Attendu ${formatCurrency(expected)}`, `Encaissé ${formatCurrency(collected)}`, expected > 0 ? `Taux ${formatPercent((collected / expected) * 100)}` : '—'] });
    items.ltv.push({ property: p, share, value: est > 0 ? (crd / est) * 100 : 0, breakdown: [`Valeur estimée ${formatCurrency(est)}`, `CRD ${formatCurrency(crd)}`] });
    items.grossYield.push({ property: p, share, value: perf.grossYield, breakdown: [`Loyer HC annuel ${formatCurrency(perf.operatingIncome.rentalIncome)}`, `Coût d'acquisition ${formatCurrency(perf.acquisitionCost.total)}`] });
    items.netYield.push({ property: p, share, value: perf.netYield, breakdown: [`Loyer HC annuel ${formatCurrency(perf.operatingIncome.rentalIncome)}`, `Charges non récupérables ${formatCurrency(perf.operatingIncome.nonRecoverableOpEx)}`, `NOI ${formatCurrency(perf.operatingIncome.netOperatingIncome)}`, `Coût d'acquisition ${formatCurrency(perf.acquisitionCost.total)}`, `Crédit non soustrait`] });
    items.cashOnCash.push({ property: p, share, value: perf.cashOnCash, breakdown: [`Cash-flow réel ${formatCurrency(perf.actualCashflow)}`, `Capital investi ${formatCurrency(perf.investedCapital)}`] });
    items.occupation.push({ property: p, share, value: propLots.length ? (occupied / propLots.length) * 100 : 0, breakdown: [`${occupied}/${propLots.length} lots occupés`] });
  }

  k.equity = round2(k.equity);
  k.ltv = k.estimatedValue > 0 ? (k.crd / k.estimatedValue) * 100 : 0;
  k.grossYield = yieldAcq > 0 ? (yieldRent / yieldAcq) * 100 : 0;
  k.netYield = yieldAcq > 0 ? (yieldNoi / yieldAcq) * 100 : 0;
  k.cashOnCash = investedCapital > 0 ? (k.cashflow / investedCapital) * 100 : 0;
  k.encaissementRate = expectedRentAnnual > 0 ? (collectedRentAnnual / expectedRentAnnual) * 100 : 0;
  k.occupationRate = totalLots > 0 ? (occupiedLots / totalLots) * 100 : 0;

  const activeImpayes = impayes.filter((i) => i.status !== 'régularisé' && i.status !== 'abandonné' && propIds.has(i.property_id));
  k.totalImpaye = activeImpayes.reduce((s, i) => s + (i.missing_amount || 0), 0);

  for (const key of ['estimatedValue', 'acquisitionCost', 'crd', 'rentalIncome12m', 'charges', 'debtService', 'cashflow', 'totalImpaye']) {
    k[key] = round2(k[key]);
  }

  const itemsImpaye = activeImpayes.map((imp) => ({
    property: { name: imp.property_name || '—' },
    share: 1,
    value: imp.missing_amount || 0,
    breakdown: [`${imp.tenant_name || ''} · ${imp.period}`, `Attendu ${formatCurrency(imp.expected_amount)}`, `Reçu ${formatCurrency((imp.expected_amount || 0) - (imp.missing_amount || 0))}`],
  }));

  // ── Actions à traiter ──
  const actions = [];
  for (const imp of activeImpayes) {
    actions.push({ id: `imp-${imp.id}`, type: 'impaye', severity: 'critical', label: 'Loyer impayé', detail: `${imp.tenant_name || ''} — ${imp.property_name || ''} · ${formatCurrency(imp.missing_amount || 0)} (${imp.period})`, link: '/impayes' });
  }
  if (bankTxPending.length > 0) {
    actions.push({ id: 'bank-pending', type: 'bank', severity: 'warning', label: 'Paiements à rapprocher', detail: `${bankTxPending.length} transaction(s) bancaire(s) non catégorisée(s)`, link: '/import' });
  }
  const quittancesUnsent = quittances.filter((q) => q.status === 'generated' && propIds.has(q.property_id));
  if (quittancesUnsent.length > 0) {
    actions.push({ id: 'quitt-unsent', type: 'quittance', severity: 'warning', label: 'Quittances à envoyer', detail: `${quittancesUnsent.length} quittance(s) générée(s) non envoyée(s)`, link: '/quittances' });
  }
  for (const l of filteredLeases) {
    if (!l.date_end || l.status === 'resilie' || l.status === 'termine') continue;
    const days = Math.round((new Date(l.date_end) - new Date(today)) / 86400000);
    if (days <= 90) {
      actions.push({ id: `lease-${l.id}`, type: 'lease', severity: days < 0 ? 'critical' : 'warning', label: days < 0 ? 'Bail expiré' : 'Bail arrivant à expiration', detail: `${l.tenants?.[0]?.name || ''} — ${propName(l.property_id)} · échéance ${l.date_end}`, link: `/biens/${l.property_id}` });
    }
  }
  const tenYearsAgo = new Date(today);
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
  const tenYearsAgoISO = tenYearsAgo.toISOString().slice(0, 10);
  for (const lot of filteredLots) {
    const stale = !lot.dpe_date || lot.dpe_date < tenYearsAgoISO || ['F', 'G'].includes(lot.dpe_class);
    if (stale) {
      actions.push({ id: `dpe-${lot.id}`, type: 'dpe', severity: 'info', label: 'DPE à renouveler', detail: `${lot.designation || ''} — ${propName(lot.property_id)}${lot.dpe_class ? ` · classe ${lot.dpe_class}` : ''}${!lot.dpe_date ? ' · DPE manquant' : ''}`, link: `/biens/${lot.property_id}` });
    }
  }
  for (const l of filteredLeases) {
    if (l.indexation_type && l.indexation_type !== 'aucune' && l.next_revision_date && l.next_revision_date <= today) {
      actions.push({ id: `idx-${l.id}`, type: 'indexation', severity: 'info', label: 'Indexation disponible', detail: `${l.tenants?.[0]?.name || ''} — ${propName(l.property_id)} · révision ${l.next_revision_date}`, link: `/biens/${l.property_id}` });
    }
  }
  for (const p of filtered) {
    const hasInsTx = transactions.some((t) => t.property_id === p.id && ['property_insurance', 'unpaid_rent_insurance'].includes(resolveKey(t.category)) && t.type === 'expense' && Number(t.year) === Number(year));
    if (!hasInsTx && (p.pno_insurance || 0) > 0) {
      actions.push({ id: `ins-${p.id}`, type: 'insurance', severity: 'info', label: 'Assurance à renouveler', detail: `${p.name} — aucune prime d'assurance enregistrée sur ${year}`, link: `/biens/${p.id}` });
    }
  }
  const sevOrder = { critical: 0, warning: 1, info: 2 };
  actions.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));

  // ── Détails KPI (shape BreakdownDetails) ──
  const detail = (title, total, itemsList, formula, fmt = formatCurrency, signed = false) => ({
    title, total, formula,
    items: itemsList.map((it) => ({
      propertyName: it.property.name,
      share: it.share,
      value: fmt === formatCurrency ? formatCurrency(it.value, signed) : fmt(it.value),
      breakdown: it.breakdown || (it.share < 1 ? [`Part ${formatPercent(it.share * 100)}`] : []),
    })),
  });

  const kpiDetails = {
    estimatedValue: detail('Valeur actuelle estimée', formatCurrency(k.estimatedValue), items.estimatedValue, 'Σ(Valeur estimée × Part) — à défaut le prix de revient'),
    acquisitionCost: detail('Prix de revient', formatCurrency(k.acquisitionCost), items.acquisitionCost, 'Σ(Achat + Notaire + Agence + Travaux) × Part'),
    crd: detail('Capital restant dû', formatCurrency(k.crd), items.crd, 'Σ(CRD aujourd’hui × Part) — via loanEngine'),
    equity: detail('Patrimoine net (equity)', formatCurrency(k.equity), items.equity, 'Valeur estimée − Capital restant dû'),
    ltv: detail('LTV (Loan-to-Value)', formatPercent(k.ltv), items.ltv, 'CRD / Valeur estimée', formatPercent),
    rentalIncome: detail('Revenus locatifs (12 mois)', formatCurrency(k.rentalIncome12m), items.rentalIncome, "Σ(revenus d'exploitation × Part) — via financeEngine"),
    charges: detail('Charges (12 mois)', formatCurrency(k.charges), items.charges, "Σ(charges d'exploitation × Part) — via financeEngine"),
    debtService: detail('Service de la dette (12 mois)', formatCurrency(k.debtService), items.debtService, 'Σ(capital + intérêts + assurance) × Part'),
    cashflow: detail('Cash-flow (12 mois)', formatCurrency(k.cashflow, true), items.cashflow, 'Revenus − Charges − Service de la dette (financeEngine)', formatCurrency, true),
    grossYield: detail('Rendement brut', formatPercent(k.grossYield), items.grossYield, "Loyer HC annuel / Coût d'acquisition", formatPercent),
    netYield: detail('Rendement net', formatPercent(k.netYield), items.netYield, "NOI (loyers − charges non récupérables) / Coût d'acquisition — crédit non soustrait", formatPercent),
    cashOnCash: detail('Cash-on-cash', formatPercent(k.cashOnCash), items.cashOnCash, 'Cash-flow / Capital investi (apport)', formatPercent),
    encaissement: detail("Taux d'encaissement", formatPercent(k.encaissementRate), items.encaissement, 'Loyers encaissés / Loyers attendus (×12)', formatPercent),
    occupation: detail("Taux d'occupation", formatPercent(k.occupationRate), items.occupation, 'Lots occupés / Lots total', formatPercent),
    impaye: detail('Total impayé', formatCurrency(k.totalImpaye), itemsImpaye, 'Σ(manquant des impayés actifs)'),
  };

  return { kpis: k, kpiDetails, actions, filteredProperties: filtered, filteredLots, filteredLeases };
}