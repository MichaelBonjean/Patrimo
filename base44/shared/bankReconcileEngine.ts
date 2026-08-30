/**
 * MOTEUR DE RÉCONCILIATION BANCAIRE CENTRAL (source canonique).
 *
 *   BankTransaction (brute) → Proposition de rapprochement
 *                           → Transaction (interprétation financière)
 *                           → Payment (encaissement affecté à un Lease/RentDue)
 *
 * PHILOSOPHIE Patrimo : DOCUMENT FIRST + ZERO INPUT + EXCEPTION ONLY.
 *  - Ordre de matching : BankRule → virement interne → RentDue → Loan →
 *    catégorie historique → catégorisation déterministe → IA (à venir) → à vérifier.
 *  - Trois niveaux de confiance : AUTOMATIQUE (≥ 0.90), PROPOSÉ (≥ 0.55),
 *    À IDENTIFIER (< 0.55). L'UI ne présente que les exceptions.
 *  - Moteur PUR : aucun accès base, aucun effet de bord. Testable isolément,
 *    réutilisable côté front (aperçu) et backend (rapprochement batch).
 *
 * Miroir frontend : src/lib/bankReconcileEngine.js (ré-export).
 */

import { computeMonthlyPayment } from './loanEngine.ts';
import { resolveKey, cashflowBucketOf } from './financeEngine.ts';
import { labelOf } from './financeCategories.ts';

// ── Seuils de confiance ────────────────────────────────────────────────────
export const THRESHOLDS = { automatic: 0.90, proposed: 0.55 };
export const LEVELS = ['automatic', 'proposed', 'to_identify'];

export function levelFromConfidence(c: number): string {
  const n = Number(c) || 0;
  if (n >= THRESHOLDS.automatic) return 'automatic';
  if (n >= THRESHOLDS.proposed) return 'proposed';
  return 'to_identify';
}

// ── Normalisation du libellé bancaire ──────────────────────────────────────
const NOISE = new Set([
  'cb', 'vir', 'virement', 'virmt', 'prlv', 'prelevement', 'prelev', 'prelvt',
  'payment', 'paiement', 'paymt', 'du', 'le', 'la', 'les', 'de', 'des', 'a',
  'au', 'et', 'the', 'of', 'for', 'to', 'ref', 'facture', ' cpt ', 'sep a',
]);

export function normalizeDescription(input = ''): string {
  let s = String(input ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/\d{2}[/\-.]\d{2}[/\-.]\d{2,4}/g, ' ');
  s = s.replace(/[^a-z\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s.split(' ').filter((t) => t && t.length >= 2 && !NOISE.has(t)).join(' ');
}

export function tokens(s: string): string[] {
  return String(s || '').split(' ').filter(Boolean);
}

export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(normalizeDescription(a)));
  const tb = new Set(tokens(normalizeDescription(b)));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter += 1; });
  return inter / Math.max(ta.size, tb.size);
}

export function nameCited(name: string, desc: string): number {
  const dn = new Set(tokens(normalizeDescription(desc)));
  const nms = tokens(normalizeDescription(name)).filter((t) => t.length >= 3);
  if (!nms.length) return 0;
  const hits = nms.filter((t) => dn.has(t)).length;
  if (hits === 0) return 0;
  if (hits >= 2) return 0.95;
  if (nms.length === 1) return 0.7;
  return 0.9;
}

// ── Mot-clé → catégorie canonique ──────────────────────────────────────────
const EXPENSE_KEYWORDS: [string, string][] = [
  ['pret', 'loan_installment'], ['prets', 'loan_installment'], ['echeance', 'loan_installment'],
  ['assurance pret', 'loan_insurance'], ['assurance emprunteur', 'loan_insurance'],
  ['assurance', 'property_insurance'], ['pno', 'property_insurance'], ['axa', 'property_insurance'],
  ['maaf', 'property_insurance'], ['mgen', 'property_insurance'],
  ['taxe fonciere', 'property_tax'], ['fonciere', 'property_tax'], ['cfe', 'cfe'],
  ['urssaf', 'tax_income'], ['dgfip', 'tax_income'], ['impot', 'tax_income'], ['impots', 'tax_income'],
  ['impot revenu', 'tax_income'], ['is ', 'tax_income'], ['tva', 'vat'],
  ['syndic', 'condo_fees'], ['copropriete', 'condo_fees'], ['copro', 'condo_fees'],
  ['gestion', 'management_fees'], ['gestionnaire', 'management_fees'], ['foncia', 'management_fees'],
  ['comptable', 'accounting_fees'], ['expertise', 'accounting_fees'], ['cabinet', 'accounting_fees'],
  ['notaire', 'notary_fees'], ['huissier', 'legal_fees'], ['avocat', 'legal_fees'],
  ['frais bancaire', 'bank_fees'], ['cotisation', 'bank_fees'], ['abonnement', 'bank_fees'],
  ['sci', 'sci_fees'],
  ['edf', 'electricity'], ['electricite', 'electricity'], ['engie', 'gas'], ['gdf', 'gas'],
  ['eau', 'water'], ['veolia', 'water'], ['suez', 'water'], ['gaz', 'gas'],
  ['internet', 'internet'], ['orange', 'internet'], ['free ', 'internet'], ['bouygues', 'internet'],
  ['ordures menageres', 'waste'], ['teom', 'waste'],
  ['leroy merlin', 'supplies'], ['castorama', 'supplies'], ['brico', 'supplies'],
  ['travaux', 'works'], [' renovation', 'works'], ['peinture', 'works'],
  ['entretien', 'maintenance'], ['chaudiere', 'maintenance'], ['plombier', 'maintenance'],
  ['artisan', 'maintenance'],
  ['agence', 'agency_fees'],
];

const INCOME_KEYWORDS: [string, string][] = [
  ['caf', 'caf'], ['apl', 'caf'], ['allocation logement', 'caf'],
  ['caution', 'deposit_received'], ['depot garantie', 'deposit_received'],
  ['remboursement tva', 'vat_refund'],
];

function keywordCategory(desc: string): string | null {
  const n = normalizeDescription(desc);
  for (const [kw, cat] of EXPENSE_KEYWORDS) {
    if (n.includes(kw)) return cat;
  }
  for (const [kw, cat] of INCOME_KEYWORDS) {
    if (n.includes(kw)) return cat;
  }
  return null;
}

const STRUCTURE_TYPES = new Set(['SCI', 'SCI familiale', 'SARL', 'SARL de famille', 'SAS', 'SASU', 'EURL', 'SCPI', 'Société civile', 'Holding', 'Autre société']);
export function isStructureHolderType(type: string): boolean {
  return !!type && (STRUCTURE_TYPES.has(type) || /sci|sarl|sas|soci/i.test(type));
}

// ── 1) RÈGLES UTILISATEUR (BankRule) ─────────────────────────────────────────
export function applyRules(bt: any, rules: any[] = []): any | null {
  const nd = normalizeDescription(bt.raw_description);
  if (!nd) return null;
  const amt = Number(bt.amount) || 0;
  const actives = rules
    .filter((r) => r && r.is_active !== false && r.keyword)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  for (const r of actives) {
    const rk = normalizeDescription(r.keyword);
    if (!rk || !nd.includes(rk)) continue;
    const c = r.conditions || {};
    if (c.direction && c.direction !== 'any') {
      const dir = amt >= 0 ? 'in' : 'out';
      if (dir !== c.direction) continue;
    }
    if (c.amount_min != null && amt < Number(c.amount_min)) continue;
    if (c.amount_max != null && amt > Number(c.amount_max)) continue;
    if (c.account_id && bt.account_id && String(c.account_id) !== String(bt.account_id)) continue;
    return {
      category: r.assigned_category,
      property_id: r.assigned_property_id || null,
      lot_id: r.assigned_lot_id || null,
      lease_id: r.assigned_lease_id || null,
      rule_id: r.id || null,
      reason: `Règle « ${r.keyword} » → ${labelOf(r.assigned_category) || r.assigned_category}`,
    };
  }
  return null;
}

// ── 2) DÉTECTION DE LOYER (RentDue) ──────────────────────────────────────────
export function matchRent(bt: any, ctx: any = {}): any | null {
  const amt = Number(bt.amount) || 0;
  if (amt <= 0) return null;
  const rentDues = ctx.rent_dues || [];
  const leases = ctx.leases || [];
  const open = rentDues.filter((rd: any) => rd && (rd.status === 'unpaid' || rd.status === 'partial') && (Number(rd.balance) || Number(rd.total_due) || 0) > 0.01);
  if (!open.length) return null;

  const leaseById = new Map(leases.map((l: any) => [l.id, l]));
  const scored: any[] = [];
  for (const rd of open) {
    const lease = leaseById.get(rd.lease_id);
    const tenantName = rd.tenant_name || (lease?.tenants?.[0]?.name) || '';
    const expected = Number(rd.balance) || Number(rd.total_due) || 0;
    if (!expected || !tenantName) continue;

    const nameScore = nameCited(tenantName, bt.raw_description);

    let amountScore = 0;
    let matchKind = 'partial';
    const diff = amt - expected;
    if (Math.abs(diff) <= 0.5) { amountScore = 1.0; matchKind = 'exact'; }
    else if (amt < expected - 0.5 && amt >= expected * 0.30) { amountScore = 0.8; matchKind = 'partial'; }
    else if (amt > expected * 1.02) { amountScore = 0.7; matchKind = 'over'; }
    else amountScore = 0;

    let dateScore = 0.4;
    if (rd.due_date) {
      const d1 = new Date(String(bt.date).slice(0, 10)).getTime();
      const d2 = new Date(String(rd.due_date).slice(0, 10)).getTime();
      if (!isNaN(d1) && !isNaN(d2)) {
        const days = Math.abs(d1 - d2) / 86400000;
        dateScore = days <= 35 ? 0.4 : 0;
      }
    }

    const confidence = nameScore * 0.55 + amountScore * 0.35 + dateScore * 0.10;
    scored.push({ rd, lease, tenantName, expected, nameScore, amountScore, matchKind, confidence });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.confidence - a.confidence);
  const best = scored[0];
  if (best.nameScore === 0) return null;

  const tie = scored
    .filter((s) => s !== best && Math.abs(s.confidence - best.confidence) < 0.05 && s.amountScore > 0.7);
  const tieNote = tie.length
    ? `Autre(s) échéance(s) proche(s) possible(s) : « ${tie.map((t) => t.tenantName).join(', ')} ».`
    : null;

  const payerType = /caf|apl|allocation logement/.test(normalizeDescription(bt.raw_description)) ? 'caf' : 'tenant';
  const allocated = Math.min(amt, best.expected);
  const payment_patch = {
    lease_id: best.lease?.id || best.rd.lease_id,
    rent_due_id: best.rd.id,
    date: String(bt.date).slice(0, 10),
    amount: amt,
    payer_type: payerType,
    payer_name: best.tenantName,
    method: 'virement',
    transaction_id: bt.id || null,
    allocations: [{ rent_due_id: best.rd.id, amount: round2(allocated) }],
    unallocated: round2(Math.max(0, amt - best.expected)),
  };

  return {
    rent_due_id: best.rd.id,
    lease_id: best.lease?.id || best.rd.lease_id,
    property_id: best.lease?.property_id || best.rd.property_id,
    lot_id: best.lease?.lot_id || best.rd.lot_id,
    tenant_name: best.tenantName,
    expected_amount: round2(best.expected),
    match_kind: best.matchKind,
    confidence: round3(best.confidence),
    tie_note: tieNote,
    payment_patch,
  };
}

// ── 3) ÉCHEANCE DE PRÊT (Loan) ───────────────────────────────────────────────
export function matchLoan(bt: any, ctx: any = {}): any | null {
  const amt = Math.abs(Number(bt.amount) || 0);
  if (amt <= 0) return null;
  const loans = ctx.loans || [];
  if (!loans.length) return null;
  const account = ctx.account || null;

  const candidates: any[] = [];
  for (const loan of loans) {
    let expected = 0;
    try {
      if (loan.monthly_payment) expected = Number(loan.monthly_payment);
      else if (loan.loan_amount && (loan.rate || loan.loan_rate) && (loan.duration_years || loan.loan_duration_years)) {
        expected = computeMonthlyPayment({
          loan_amount: Number(loan.loan_amount),
          rate: Number(loan.rate || loan.loan_rate),
          duration_years: Number(loan.duration_years || loan.loan_duration_years),
          monthly_insurance: Number(loan.insurance || loan.monthly_insurance || 0),
        });
      }
    } catch (e) { expected = 0; }
    if (!expected || !Number.isFinite(expected)) continue;

    const delta = amt - expected;
    const deltaPct = Math.abs(delta) / expected;
    let confidence = 0;
    let note;
    if (Math.abs(delta) <= 0.5) { confidence = 0.95; note = "Conforme à l'échéance attendue"; }
    else if (deltaPct <= 0.05 || Math.abs(delta) <= 12) { confidence = 0.8; note = `Écart faible de ${round2(Math.abs(delta))} €`; }
    else { continue; }

    const scoreBoost = (account?.holder_id && loan.holder_id === account.holder_id) ? 0.05 : 0;
    candidates.push({
      loan_id: loan.id || loan.loan_id,
      property_id: loan.property_id || null,
      holder_id: loan.holder_id || null,
      expected_monthly: round2(expected),
      detected_amount: round2(amt),
      delta: round2(delta),
      conforme: Math.abs(delta) <= 1,
      note,
      confidence: round3(confidence + scoreBoost),
    });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates[0];
}

// ── 4) VIREMENT INTERNE ───────────────────────────────────────────────────────
export function detectInternalTransfer(bt: any, othersPool: any[] = []): any | null {
  const amt = Math.abs(Number(bt.amount) || 0);
  if (amt <= 0) return null;
  const isIncome = Number(bt.amount) > 0;
  const myAcct = String(bt.account_id || '').toLowerCase();
  const d1 = new Date(String(bt.date).slice(0, 10)).getTime();
  for (const o of othersPool) {
    if (!o || o.id === bt.id) continue;
    if (String(o.account_id || '').toLowerCase() === myAcct) continue;
    const oInc = Number(o.amount) > 0;
    if (oInc === isIncome) continue;
    const amt2 = Math.abs(Number(o.amount) || 0);
    if (Math.abs(amt2 - amt) > Math.max(0.5, amt * 0.01)) continue;
    const d2 = new Date(String(o.date).slice(0, 10)).getTime();
    if (isNaN(d1) || isNaN(d2)) continue;
    if (Math.abs(d1 - d2) / 86400000 > 7) continue;
    return {
      counterparty_bt_id: o.id,
      counterparty_account_id: o.account_id,
      amount: round2(amt),
      confidence: Math.abs(amt2 - amt) < 0.001 ? 0.92 : 0.7,
      note: Math.abs(amt2 - amt) < 0.001
        ? 'Montant opposé · sens inverse · comptes distincts (même patrimoine)'
        : 'Montant proche · sens inverse · comptes distincts',
    };
  }
  return null;
}

// ── 5) AFFECTATION bien vs structure vs non affectée ─────────────────────────
export function defaultExpenseScope(account: any, holders: any[] = []): string {
  if (account?.property_id) return 'property';
  const holder = holders.find((h) => h.id === account?.holder_id);
  if (account?.holder_id && holder && isStructureHolderType(holder.type)) return 'structure';
  if (account?.holder_id && holder && (!holder.type || holder.type === 'Personne physique')) return 'person';
  return 'non_affectee';
}

// ── 6) RÉCONCILIATION D'UNE LIGNE BRUTE ──────────────────────────────────────
export function reconcileBankTransaction(bt: any, ctx: any = {}): any {
  const amt = Number(bt.amount) || 0;
  const account = ctx.account || (ctx.accounts || []).find((a: any) => a.account_masked_id === bt.account_id) || null;
  const evidence: string[] = [];

  // (a) Règle utilisateur — priorité maximale (décision mémorisée).
  const rule = applyRules(bt, ctx.rules || []);
  if (rule) {
    evidence.push(`Règle appliquée : « ${rule.reason} ».`);
    const categoryKey = resolveKey(rule.category);
    const isIncomeCat = categoryKey && cashflowBucketOf(rule.category) === 'operating_income' && amt > 0;
    return finalize({
      type: isIncomeCat ? 'rent_income' : scopeCategory(rule.category, account, ctx.holders || []),
      level: 'proposed',
      confidence: 0.93,
      reason: rule.reason,
      transaction_patch: txPatch(bt, rule.category, rule.property_id, rule.lot_id, account, ctx.holders || []),
      rule_id: rule.rule_id,
      evidence,
    });
  }

  // (b) Revenu → tentative de loyer (RentDue).
  if (amt > 0) {
    const rent = matchRent(bt, ctx);
    if (rent) {
      evidence.push(`Échéance reconnue : « ${rent.tenant_name} » — attendu ${rent.expected_amount} € (${rent.match_kind}).`);
      if (rent.tie_note) evidence.push(rent.tie_note);
      return finalize({
        type: 'rent_income',
        level: levelFromConfidence(rent.confidence * (rent.tie_note ? 0.85 : 1)),
        confidence: round3(rent.confidence * (rent.tie_note ? 0.85 : 1)),
        reason: rent.tie_note
          ? `Loyer possible pour « ${rent.tenant_name} » (ambigu — à confirmer)`
          : `Loyer encaissé : « ${rent.tenant_name} » — ${rent.match_kind}`,
        rent_due_id: rent.rent_due_id,
        payment_patch: rent.payment_patch,
        transaction_patch: txPatch(bt, 'rent', rent.property_id, rent.lot_id, account, ctx.holders || []),
        evidence,
      });
    }
    const kw = keywordCategory(bt.raw_description);
    if (kw && cashflowBucketOf(kw) !== 'excluded') {
      evidence.push(`Revenu identifié par mot-clé : ${labelOf(kw)}.`);
      return finalize({
        type: 'income_other',
        level: 'proposed',
        confidence: 0.7,
        reason: `Revenu : ${labelOf(kw)}`,
        transaction_patch: txPatch(bt, kw, account?.property_id || null, null, account, ctx.holders || []),
        evidence,
      });
    }
  } else if (amt < 0) {
    // (c) Débit → échéance de prêt (Loan) — étape 4 de l'ordre de matching.
    const loan = matchLoan(bt, ctx);
    if (loan) {
      evidence.push(`Échéance prêt : attendu ${loan.expected_monthly} €, détecté ${loan.detected_amount} € (${loan.note}).`);
      return finalize({
        type: 'loan_installment',
        level: loan.conforme ? 'automatic' : 'proposed',
        confidence: loan.confidence,
        reason: loan.conforme
          ? `Échéance de prêt conforme (${loan.expected_monthly} €)`
          : `Écart détecté : ${Math.abs(loan.delta)} € vs échéance ${loan.expected_monthly} €`,
        loan_id: loan.loan_id,
        transaction_patch: txPatch(bt, 'loan_installment', loan.property_id, null, account, ctx.holders || []),
        evidence,
      });
    }

    // (d) Virement inter-comptes — étape 2.
    const tr = detectInternalTransfer(bt, ctx.transfert_pool || (ctx.accounts || []));
    if (tr) {
      evidence.push(tr.note);
      return finalize({
        type: 'internal_transfer',
        level: tr.confidence >= THRESHOLDS.automatic ? 'automatic' : 'proposed',
        confidence: tr.confidence,
        reason: `Virement interne probable (compte ${tr.counterparty_account_id})`,
        transaction_patch: txPatch(bt, 'internal_transfer', account?.property_id || null, null, account, ctx.holders || [], { transfer_hint: tr.counterparty_bt_id }),
        evidence,
      });
    }

    // (e) Catégorie par mot-clé → dépense.
    const kw = keywordCategory(bt.raw_description);
    if (kw && cashflowBucketOf(kw) !== 'excluded') {
      const scope = defaultExpenseScope(account, ctx.holders || []);
      const type = scopeCategory(kw, account, ctx.holders || []);
      const propertyId = account?.property_id || null;
      evidence.push(`Dépense classée « ${labelOf(kw)} » (affectation : ${scope}).`);
      return finalize({
        type,
        level: scope === 'structure' ? 'proposed' : (propertyId ? 'automatic' : 'proposed'),
        confidence: scope === 'non_affectee' ? 0.6 : 0.85,
        reason: `Dépense : ${labelOf(kw)} — affectation ${scopeDescription(scope)}`,
        transaction_patch: txPatch(bt, kw, propertyId, null, account, ctx.holders || [], { scope }),
        evidence,
      });
    }
  }

  // (f) Inconnu — à vérifier.
  evidence.push('Aucun rapprochement fiable. À qualifier manuellement.');
  return finalize({
    type: 'unknown',
    level: 'to_identify',
    confidence: 0,
    reason: 'Opération non identifiée',
    transaction_patch: txPatch(bt, 'other', null, null, account, ctx.holders || []),
    evidence,
  });
}

function finalize(p: any): any {
  if (!p.level) p.level = levelFromConfidence(p.confidence);
  return p;
}

function scopeCategory(categoryKey: string, account: any, holders: any[]): string {
  const bucket = cashflowBucketOf(categoryKey);
  if (bucket === 'excluded' && (categoryKey === 'tax_income' || categoryKey === 'vat' || categoryKey === 'property_tax' || categoryKey === 'cfe')) return 'tax';
  const scope = defaultExpenseScope(account, holders);
  if (cashflowBucketOf(categoryKey) === 'operating_income') return 'rent_income';
  if (bucket === 'debt_service') return 'finance';
  if (scope === 'structure') return 'structure_expense';
  return 'property_expense';
}

// ── 7) PATCH Transaction ────────────────────────────────────────────────────
function txPatch(bt: any, categoryKey: string, propertyId: string | null, lotId: string | null, account: any, holders: any[], extra: any = {}): any {
  const amt = Number(bt.amount) || 0;
  const { year, month } = ym(bt.date);
  return {
    owner_id: bt.owner_id || null,
    property_id: propertyId || null,
    lot_id: lotId || null,
    year, month,
    category: categoryKey,
    category_label: labelOf(categoryKey),
    amount: amt,
    type: amt >= 0 ? 'income' : 'expense',
    bank_import_id: bt.source_import_id || null,
    ...extra,
  };
}

// ── 8) VALIDATION GROUPÉE (EXCEPTION ONLY) ───────────────────────────────────
export function aggregateReconcile(proposals: any[] = []): any {
  const automatic = proposals.filter((p) => p.level === 'automatic');
  const proposed = proposals.filter((p) => p.level === 'proposed');
  const toIdentify = proposals.filter((p) => p.level === 'to_identify');
  return {
    total: proposals.length,
    automatic_count: automatic.length,
    proposed_count: proposed.length,
    to_identify_count: toIdentify.length,
    exceptions: proposed.concat(toIdentify),
    all_recognized: toIdentify.length === 0 && proposed.length === 0,
  };
}

// ── 9) CASH-FLOW RÉEL ───────────────────────────────────────────────────────
export function computeRealCashflow(transactions: any[] = []): any {
  let operating_income = 0, operating_expense = 0, debt_service = 0, excluded = 0;
  for (const t of transactions) {
    const bucket = cashflowBucketOf(t.category);
    const amt = Math.abs(Number(t.amount) || 0);
    if (t.type === 'expense' || Number(t.amount) < 0) {
      if (bucket === 'debt_service') debt_service += amt;
      else if (bucket === 'operating_expense') operating_expense += amt;
      else if (bucket === 'excluded') excluded += amt;
      else debt_service += amt;
    } else {
      if (bucket === 'operating_income') operating_income += amt;
      else excluded += amt;
    }
  }
  const net = round2(operating_income - operating_expense - debt_service);
  return { operating_income: round2(operating_income), operating_expense: round2(operating_expense), debt_service: round2(debt_service), excluded: round2(excluded), net };
}

// ── 10) APPRENTISSAGE : proposition de règle ─────────────────────────────────
export function suggestRuleFromProposal(proposal: any, bt: any): any | null {
  if (!proposal || proposal.level === 'automatic') return null;
  const nd = normalizeDescription(bt.raw_description);
  const cands = tokens(nd).filter((t) => t.length >= 4);
  if (!cands.length) return null;
  const keyword = cands.sort((a, b) => b.length - a.length)[0];
  const category = proposal.transaction_patch?.category || null;
  const property_id = proposal.transaction_patch?.property_id || null;
  const lot_id = proposal.transaction_patch?.lot_id || null;
  return {
    keyword,
    assigned_category: category,
    assigned_property_id: property_id,
    assigned_lot_id: lot_id,
    is_active: true,
    priority: 50,
    reason: `Apprise à partir de la validation « ${keyword} »`,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function ym(dateStr: string): { year: number; month: number } {
  const d = String(dateStr || '').slice(0, 10);
  const m = d.match(/^(\d{4})-(\d{2})/);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : { year: NaN, month: NaN };
}
function round2(v: number): number { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; }
function round3(v: number): number { return Math.round(Number(v) * 1000) / 1000; }
function scopeDescription(scope: string): string {
  if (scope === 'structure') return 'structure (SCI/société)';
  if (scope === 'property') return 'bien';
  if (scope === 'person') return 'en propre';
  return 'non affectée';
}