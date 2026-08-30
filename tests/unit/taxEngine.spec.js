import { describe, it, expect } from 'vitest';
import {
  buildEstimate,
  treatmentOf,
  regimeOf,
  calcIS,
  DISCLAIMER,
  REGIME_CAPS,
} from '../../base44/shared/taxEngine.ts';

describe('taxEngine — simulation fiscale indicative', () => {
  it('mention de non-conseil toujours présente', () => {
    expect(buildEstimate({ property: { tax_regime: 'location nue (revenus fonciers)' }, transactions: [], year: 2024 }).disclaimer).toBe(DISCLAIMER);
  });

  it('micro-foncier : abattement 30 %, aucune charge déductible', () => {
    const e = buildEstimate({
      property: { tax_regime: 'Location nue (micro-foncier)', name: 'A' },
      transactions: [
        { category: 'rent', amount: 1000, type: 'income' },
        { category: 'property_tax', amount: 200, type: 'expense' },
      ],
      year: 2024,
    });
    expect(e.kind).toBe('micro');
    expect(e.revenue).toBe(1000);
    expect(e.deductibleCharges).toBe(0); // micro : non déductibles
    expect(e.taxableBase).toBeCloseTo(700, 0); // 1000 * (1 - 30%)
  });

  it('réel foncier : charges déductibles, intérêts déductibles, capital NON déductible', () => {
    const e = buildEstimate({
      property: {
        tax_regime: 'Location nue (revenus fonciers)', name: 'A',
        loan_amount: 100000, loan_rate: 3, loan_duration_years: 10, loan_start_date: '2024-01-05',
      },
      transactions: [
        { category: 'rent', amount: 1000, type: 'income' },
        { category: 'property_tax', amount: 200, type: 'expense' },
        { category: 'condo_fees', amount: 150, type: 'expense' },
        { category: 'loan_installment', amount: 600, type: 'expense' },
      ],
      year: 2024,
    });
    expect(e.kind).toBe('reel');
    expect(e.deductibleCharges).toBeCloseTo(350, 0); // foncière + copropriété
    expect(e.interest).toBeGreaterThan(0);
    expect(e.nonDeductibleCharges).toBeGreaterThanOrEqual(0); // capital remboursé en info
    expect(e.taxableBase).toBeCloseTo(1000 - 350 - e.interest, 0);
  });

  it('régime non géré → non supporté (aucun résultat produit)', () => {
    const e = buildEstimate({ property: { tax_regime: 'Régime exotique' }, transactions: [], year: 2024 });
    expect(e.unsupported).toBe(true);
    expect(e.taxableBase).toBe(0);
  });

  it('charges récupérables : neutres fiscalement (hors revenu et hors charges)', () => {
    const e = buildEstimate({
      property: { tax_regime: 'Location nue (revenus fonciers)', name: 'A', loan_amount: 0, loan_rate: 0, loan_duration_years: 0, loan_start_date: null },
      transactions: [
        { category: 'rent', amount: 1000, type: 'income' },
        { category: 'tenant_charges', amount: 80, type: 'income' },
      ],
      year: 2024,
    });
    expect(e.revenue).toBe(1000);
    expect(e.recoverable).toBeCloseTo(80, 0);
  });

  it('provisions / TVA / virements internes : non déductibles', () => {
    const e = buildEstimate({
      property: { tax_regime: 'Location nue (revenus fonciers)', name: 'A', loan_amount: 0, loan_rate: 0, loan_duration_years: 0, loan_start_date: null },
      transactions: [
        { category: 'rent', amount: 1000, type: 'income' },
        { category: 'provisions', amount: 100, type: 'expense' },
        { category: 'vat', amount: 50, type: 'expense' },
        { category: 'internal_transfer', amount: 300, type: 'expense' },
      ],
      year: 2024,
    });
    expect(e.deductibleCharges).toBe(0);
    expect(e.nonDeductibleCharges).toBeCloseTo(100, 0); // provisions (TVA classée en taxes, neutre)
    expect(e.taxableBase).toBeCloseTo(1000, 0); // aucun de ces flux ne réduit la base
  });

  it('IS : barème 15 % ≤ 42 500 € puis 25 % au-delà', () => {
    expect(calcIS(10000)).toBe(1500);
    expect(calcIS(50000)).toBe(42500 * 0.15 + 7500 * 0.25);
  });

  it('treatmentOf : dérivation depuis le catalogue canonique', () => {
    expect(treatmentOf('rent').taxable).toBe(true);
    expect(treatmentOf('loan_installment').kind).toBe('loan');
    expect(treatmentOf('vat').kind).toBe('tax');
    expect(treatmentOf('bidule').kind).toBe('unclassified');
  });

  it('REGIME_CAPS : clés connues présentes', () => {
    expect(REGIME_CAPS['Location nue (micro-foncier)'].abattement).toBe(30);
    expect(REGIME_CAPS['SCI à l\'IS'].is).toBe(true);
  });

  it('hypothèses toujours présentes (transparence)', () => {
    const e = buildEstimate({ property: { tax_regime: 'Location nue (revenus fonciers)' }, transactions: [], year: 2024 });
    expect(e.hypotheses.length).toBeGreaterThan(3);
    expect(e.hypotheses.some((h) => h.toLowerCase().includes('capital'))).toBe(true);
  });

  it('micro-BIC : abattement 50 %, travaux non déductibles', () => {
    const e = buildEstimate({
      property: { tax_regime: 'LMNP au micro-BIC', name: 'A' },
      transactions: [
        { category: 'rent', amount: 1200, type: 'income' },
        { category: 'works', amount: 400, type: 'expense' },
      ],
      year: 2024,
    });
    expect(e.taxableBase).toBeCloseTo(600, 0); // 1200 * 50%
    expect(e.deductibleCharges).toBe(0);
  });
});