import { describe, it, expect } from 'vitest';
import {
  computeVentilation,
  validateVentilation,
  resolveAllocationType,
  hasValidAllocation,
  attributeAllocations,
  consolidatedTransferNet,
} from '../../base44/shared/allocationEngine.ts';
import { detectTransferPairs, labelsMatch } from '../../base44/shared/transferEngine.ts';

const T = (over) => ({
  id: over.id,
  owner_id: 'owner@test',
  year: 2026,
  month: 8,
  amount: over.amount ?? -100,
  type: over.type ?? 'expense',
  category: over.category ?? 'other_expense',
  note: over.note,
  property_id: over.property_id,
  lot_id: over.lot_id,
  holder_id: over.holder_id,
  loan_id: over.loan_id,
  tax_scope: over.tax_scope,
  transfer_pair_id: over.transfer_pair_id,
  ...over,
});

describe('allocationEngine — modèle d\'affectation', () => {
  // 1. Comptable SCI → holder_id, pas de property_id forcé.
  it('comptable SCI → affectation holder, property_id non imposé', () => {
    const tx = T({ id: 't1', amount: -500, category: 'accounting_fees', holder_id: 'holder-sci', property_id: undefined });
    expect(resolveAllocationType(tx)).toBe('holder');
    expect(hasValidAllocation(tx)).toBe(true);
    // Non attribué à un bien en analyse (dépense de structure).
    const attr = attributeAllocations([tx], []);
    expect(Object.keys(attr).length).toBe(0);
  });

  // 2. Dépense Property → property_id.
  it('dépense Property → affectation property', () => {
    const tx = T({ id: 't2', amount: -800, category: 'property_insurance', property_id: 'p1' });
    expect(resolveAllocationType(tx)).toBe('property');
    const attr = attributeAllocations([tx], []);
    expect(attr.p1.expense).toBe(800);
    expect(attr.p1.income).toBe(0);
  });

  // 3. Crédit → loan_id.
  it('mensualité de prêt → affectation loan', () => {
    const tx = T({ id: 't3', amount: -950, category: 'loan_installment', loan_id: 'loan:p1', property_id: 'p1' });
    // loan_id prioritaire sur property_id (le prêt est l'affectation sémantique).
    expect(resolveAllocationType(tx)).toBe('loan');
    expect(hasValidAllocation(tx)).toBe(true);
  });

  // 4. Taxe (IS/IR, TVA) → tax_scope, exclue du cash-flow d'exploitation.
  it('fiscalité → affectation tax, exclue du cash-flow bien', () => {
    const tx = T({ id: 't4', amount: -1200, category: 'tax_income', tax_scope: 'is', property_id: undefined });
    expect(resolveAllocationType(tx)).toBe('tax');
    // Jamais attribuée à un bien en analyse.
    const attr = attributeAllocations([tx], []);
    expect(Object.keys(attr).length).toBe(0);
  });

  // 5. Virement interne → matching entrée/sortie, impact consolidé = 0.
  it('virement interne → paire détectée (montant, date, libellé) + impact consolidé 0', () => {
    const out = T({ id: 'v-out', amount: -1000, type: 'expense', category: 'other_expense', property_id: 'p1', note: 'Virement SCI Irigny', transfer_pair_id: undefined });
    const inn = T({ id: 'v-in', amount: 1000, type: 'income', category: 'other_expense', property_id: 'p2', note: 'Virement SCI Irigny', transfer_pair_id: undefined });
    const cands = detectTransferPairs([out, inn]);
    expect(cands.length).toBe(1);
    const c = cands[0];
    expect(c.out_tx_id).toBe('v-out');
    expect(c.in_tx_id).toBe('v-in');
    expect(c.amount_diff).toBe(0);
    expect(c.label_match).toBe(true);
    expect(c.confidence).toBe('high');

    // Après liage, on tagge les deux en internal_transfer.
    const linked = [out, inn].map((t) => ({
      ...t,
      id: t.id,
      category: 'internal_transfer',
      transfer_pair_id: t.id === 'v-out' ? 'v-in' : 'v-out',
    }));
    const net = consolidatedTransferNet(linked);
    expect(net.net).toBe(0); // ni revenu ni dépense
    expect(net.pairs).toBe(1);
    expect(net.ok).toBe(true);
    // L'entrée n'est pas un revenu, la sortie n'est pas une dépense en analyse.
    const attr = attributeAllocations(linked, []);
    expect(Object.keys(attr).length).toBe(0);
  });

  it('labelsMatch — insensible casse/accents/bruit', () => {
    expect(labelsMatch('Virement SCI Irigny', 'VIREMENT SCI IRIGNY')).toBe(true);
    expect(labelsMatch('Virement SCI Irigny', 'Loyer août')).toBe(false);
  });

  // 6. Allocation multi-biens (ventilation égalitaire) — source intacte.
  it('ventilation égalitaire — 900€ sur 3 biens → 300 chacun, source intacte', () => {
    const source = T({ id: 's1', amount: -900, category: 'accounting_fees', holder_id: 'holder-sci', property_id: undefined });
    const res = computeVentilation({
      source_amount: 900,
      method: 'equal',
      targets: [
        { target_type: 'property', target_id: 'p1' },
        { target_type: 'property', target_id: 'p2' },
        { target_type: 'property', target_id: 'p3' },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.allocations.length).toBe(3);
    expect(res.allocations.map((a) => a.amount)).toEqual([300, 300, 300]);
    expect(res.sum).toBe(900);
    expect(res.diff).toBe(0);
    // La source reste intacte (toujours holder, sans property_id).
    expect(source.property_id).toBeUndefined();
    expect(resolveAllocationType(source)).toBe('holder');

    // Validation des allocations persistées.
    const v = validateVentilation(res.allocations, 900);
    expect(v.ok).toBe(true);

    // Analyse : la dépense de structure est attribuée aux 3 biens via ventilation.
    const attr = attributeAllocations([source], res.allocations.map((a) => ({ ...a, source_transaction_id: 's1' })));
    expect(attr.p1.expense).toBe(300);
    expect(attr.p2.expense).toBe(300);
    expect(attr.p3.expense).toBe(300);
  });

  it('ventilation proportionnelle — poids 1/2/1 → 225/450/225', () => {
    const res = computeVentilation({
      source_amount: 900,
      method: 'proportional',
      targets: [
        { target_type: 'property', target_id: 'p1', weight: 1 },
        { target_type: 'property', target_id: 'p2', weight: 2 },
        { target_type: 'property', target_id: 'p3', weight: 1 },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.allocations.map((a) => a.amount)).toEqual([225, 450, 225]);
  });

  it('ventilation manuelle — impose 40/60, valide si somme = source', () => {
    const res = computeVentilation({
      source_amount: 1000,
      method: 'manual',
      targets: [
        { target_type: 'property', target_id: 'p1', percent: 40 },
        { target_type: 'property', target_id: 'p2', percent: 60 },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.allocations.map((a) => a.amount)).toEqual([400, 600]);
    // Refuse si la somme dépasse.
    const bad = computeVentilation({
      source_amount: 1000,
      method: 'manual',
      targets: [
        { target_type: 'property', target_id: 'p1', amount: 700 },
        { target_type: 'property', target_id: 'p2', amount: 500 },
      ],
    });
    expect(bad.ok).toBe(false);
  });

  // 7. Dépense non affectée → refusée.
  it('dépense non affectée → unallocated, refusée à la validation', () => {
    const tx = T({ id: 't7', amount: -200, category: 'other_expense', property_id: undefined, holder_id: undefined, loan_id: undefined, tax_scope: undefined });
    expect(resolveAllocationType(tx)).toBe('unallocated');
    expect(hasValidAllocation(tx)).toBe(false);
  });
});