import { detectTransferPairs, groupLinkedPairs } from '../../shared/transferEngine.ts';
import { computePortfolioCashflow, cashflowBucketOf } from '../../shared/financeEngine.ts';

/**
 * Tests de cohérence du moteur des TRANSFERTS INTER-COMPTES.
 *
 *  - détection d'une paire (même montant · sens opposé · même période · biens distincts)
 *  - rejet d'un flux au sein d'un même bien (pas un transfert inter-comptes)
 *  - confiance `high` (même période / montant identique) vs `medium` (période adjacente)
 *  - transactions déjà liées exclues de la détection
 *  - tolérance de montant
 *  - NEUTRALITÉ : une paire taggée `internal_transfer` a un impact cash-flow
 *    consolidé = 0 (ne gonfle ni revenus ni dépenses).
 *  - par compte individuel, le flux reste compté en `excluded.breakdown`.
 *  - groupLinkedPairs reconstruit correctement les paires liées.
 */

const eq = (a: number, b: number, label: string) =>
  Math.abs((a ?? 0) - (b ?? 0)) < 0.01
    ? { pass: true, msg: label }
    : { pass: false, msg: `${label} : attendu ${b}, obtenu ${a}` };

function run() {
  const errors: string[] = [];
  const asserts: any[] = [];
  const assert = (label: string, cond: boolean) => {
    asserts.push({ label, pass: !!cond });
    if (!cond) errors.push(label);
  };

  const tx = (over: any) => ({
    id: over.id,
    property_id: over.property_id,
    type: over.type,
    category: over.category || 'other_expense',
    amount: over.amount,
    year: over.year || 2026,
    month: over.month || 1,
    transfer_pair_id: over.transfer_pair_id || undefined,
    transfer_method: over.transfer_method || undefined,
  });

  // ── T1 : paire exacte détectée (high) ─────────────────────────────────
  {
    const txs = [
      tx({ id: 'e1', property_id: 'P1', type: 'expense', amount: -1000, year: 2026, month: 3 }),
      tx({ id: 'i1', property_id: 'P2', type: 'income', amount: 1000, year: 2026, month: 3 }),
    ];
    const c = detectTransferPairs(txs);
    assert('T1 une paire détectée', c.length === 1);
    assert('T1 high confidence', c[0]?.confidence === 'high');
    assert('T1 out=expense e1', c[0]?.out_tx_id === 'e1');
    assert('T1 in=income i1', c[0]?.in_tx_id === 'i1');
    assert('T1 amount 1000', c[0]?.amount === 1000);
    assert('T1 period_gap 0', c[0]?.period_gap === 0);
    assert('T1 amount_diff 0', c[0]?.amount_diff === 0);
  }

  // ── T2 : même bien → pas un transfert inter-comptes ───────────────────
  {
    const txs = [
      tx({ id: 'e2', property_id: 'P1', type: 'expense', amount: -500, year: 2026, month: 1 }),
      tx({ id: 'i2', property_id: 'P1', type: 'income', amount: 500, year: 2026, month: 1 }),
    ];
    const c = detectTransferPairs(txs);
    assert('T2 même bien → 0 paire', c.length === 0);
  }

  // ── T3 : période adjacente → medium ───────────────────────────────────
  {
    const txs = [
      tx({ id: 'e3', property_id: 'P1', type: 'expense', amount: -750, year: 2026, month: 2 }),
      tx({ id: 'i3', property_id: 'P2', type: 'income', amount: 750, year: 2026, month: 3 }),
    ];
    const c = detectTransferPairs(txs);
    assert('T3 une paire adjacente', c.length === 1);
    assert('T3 medium confidence', c[0]?.confidence === 'medium');
    assert('T3 period_gap 1', c[0]?.period_gap === 1);
  }

  // ── T4 : déjà lié → exclu de la détection ─────────────────────────────
  {
    const txs = [
      tx({ id: 'e4', property_id: 'P1', type: 'expense', amount: -300, year: 2026, month: 1, transfer_pair_id: 'i4' }),
      tx({ id: 'i4', property_id: 'P2', type: 'income', amount: 300, year: 2026, month: 1, transfer_pair_id: 'e4' }),
      tx({ id: 'e5', property_id: 'P3', type: 'expense', amount: -300, year: 2026, month: 1 }),
      tx({ id: 'i5', property_id: 'P4', type: 'income', amount: 300, year: 2026, month: 1 }),
    ];
    const c = detectTransferPairs(txs);
    // Seule la paire e5/i5 est candidate ; e4/i4 déjà liée.
    assert('T4 déjà liée exclue', c.length === 1);
    assert('T4 candidate = e5/i5', c[0]?.out_tx_id === 'e5' && c[0]?.in_tx_id === 'i5');
  }

  // ── T5 : tolérance de montant ─────────────────────────────────────────
  {
    const txs = [
      tx({ id: 'e6', property_id: 'P1', type: 'expense', amount: -1000, year: 2026, month: 4 }),
      tx({ id: 'i6', property_id: 'P2', type: 'income', amount: 1000.05, year: 2026, month: 4 }),
    ];
    const c1 = detectTransferPairs(txs, { tolerance_amount: 0.1 });
    assert('T5 détectée avec tolérance 0.1', c1.length === 1);
    const c2 = detectTransferPairs(txs, { tolerance_amount: 0.01 });
    assert('T5 rejetée avec tolérance 0.01', c2.length === 0);
  }

  // ── T6 : NEUTRALITÉ consolidée d'une paire taggée internal_transfer ───
  //   Avant liage : 1000 (P1 expense rent-like) + 1000 (P2 income rent-like)
  //   gonfleraient operating. Après liage (catégorie → internal_transfer),
  //   l'impact consolidé = 0 (bucket excluded, paire s'annule).
  {
    const p1 = { id: 'P1', name: 'Bien 1', monthly_payment: 0, monthly_insurance: 0, loan_amount: 0 };
    const p2 = { id: 'P2', name: 'Bien 2', monthly_payment: 0, monthly_insurance: 0, loan_amount: 0 };

    const tagged: any[] = [
      { property_id: 'P1', type: 'expense', category: 'internal_transfer', amount: -1000, year: 2026, month: 3 },
      { property_id: 'P2', type: 'income', category: 'internal_transfer', amount: 1000, year: 2026, month: 3 },
    ];
    const cf = computePortfolioCashflow([p1, p2], tagged, 2026).totals;
    assert('T6 internal_transfer → bucket excluded', cashflowBucketOf('internal_transfer') === 'excluded');
    asserts.push(eq(cf.operating_income, 0, 'T6 consolidated operating_income = 0'));
    asserts.push(eq(cf.operating_expenses, 0, 'T6 consolidated operating_expenses = 0'));
    asserts.push(eq(cf.net_operating, 0, 'T6 consolidated net_operating = 0'));
    asserts.push(eq(cf.net_cashflow, 0, 'T6 consolidated net_cashflow = 0 (neutre)'));
    asserts.push(eq(cf.excluded.amount, 0, 'T6 excluded net = 0 (sortant + entrant s annulent)'));
    // Par compte individuel : P1 excluded breakdown internal_transfer = -1000, P2 = +1000
    const cfP1 = computePortfolioCashflow([p1, p2], tagged, 2026).perProperty.find((x) => x.propertyId === 'P1')!.totals;
    const cfP2 = computePortfolioCashflow([p1, p2], tagged, 2026).perProperty.find((x) => x.propertyId === 'P2')!.totals;
    asserts.push(eq(cfP1.excluded.breakdown['internal_transfer'] || 0, -1000, 'T6 P1 excluded = -1000 (sortant)'));
    asserts.push(eq(cfP2.excluded.breakdown['internal_transfer'] || 0, 1000, 'T6 P2 excluded = +1000 (entrant)'));
    assert('T6 P1 cash-flow individuel neutre', Math.abs(cfP1.net_cashflow) < 0.01);
    assert('T6 P2 cash-flow individuel neutre', Math.abs(cfP2.net_cashflow) < 0.01);
  }

  // ── T7 : groupLinkedPairs reconstruit les paires ──────────────────────
  {
    const txs = [
      tx({ id: 'L1', property_id: 'P1', type: 'expense', amount: -200, year: 2026, month: 1, transfer_pair_id: 'L2', transfer_method: 'auto' }),
      tx({ id: 'L2', property_id: 'P2', type: 'income', amount: 200, year: 2026, month: 1, transfer_pair_id: 'L1', transfer_method: 'auto' }),
      tx({ id: 'X', property_id: 'P3', type: 'expense', amount: -99, year: 2026, month: 1 }),
    ];
    const pairs = groupLinkedPairs(txs);
    assert('T7 une paire reconstruite', pairs.length === 1);
    assert('T7 out=L1 in=L2', pairs[0]?.out?.id === 'L1' && pairs[0]?.in?.id === 'L2');
    assert('T7 method=auto', pairs[0]?.method === 'auto');
  }

  return { ok: errors.length === 0, errorCount: errors.length, errors, asserts };
}

export default async function (_req: Request): Promise<Response> {
  try {
    return Response.json(run());
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}