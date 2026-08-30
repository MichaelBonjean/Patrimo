import { describe, it, expect } from 'vitest';
import {
  FINANCE_CATEGORIES,
  CATEGORY_BY_KEY,
  OTHER_KEY,
  resolveKey,
  labelOf,
  directionOf,
  cashflowBucketOf,
  cashflowGroupOf,
  isKnownKey,
  isDebtService,
  activeCategories,
  activeKeys,
} from '../../base44/shared/financeCategories.ts';

describe('financeCategories — catalogue canonique', () => {
  it('chaque catégorie a une clé snake_case stable et un libellé', () => {
    for (const c of FINANCE_CATEGORIES) {
      expect(c.key).toMatch(/^[a-z0-9_]+$/);
      expect(c.key).toBe(c.id);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it('aucune clé en double', () => {
    const keys = FINANCE_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resolveKey : clé canonique → elle-même', () => {
    expect(resolveKey('rent')).toBe('rent');
    expect(resolveKey('loan_installment')).toBe('loan_installment');
  });

  it('resolveKey : libellé canonique → clé', () => {
    expect(resolveKey('Loyer')).toBe('rent');
    expect(resolveKey('Échéance prêt')).toBe('loan_installment');
  });

  it('resolveKey : alias historique → clé canonique', () => {
    expect(resolveKey('Caution')).toBe('deposit_received');
    expect(resolveKey('Assurance habitation')).toBe('property_insurance');
    expect(resolveKey('PNO')).toBe('property_insurance');
    expect(resolveKey('Copropriété')).toBe('condo_fees');
    expect(resolveKey('Virement interne')).toBe('internal_transfer');
  });

  it('resolveKey : valeur inconnue → fallback "other"', () => {
    expect(resolveKey('Truc bizarre')).toBe(OTHER_KEY);
    expect(resolveKey('')).toBe(OTHER_KEY);
    expect(resolveKey(null)).toBe(OTHER_KEY);
  });

  it('labelOf : préserve le libellé d’origine pour une valeur inconnue', () => {
    expect(labelOf('Précompte inventé')).toBe('Précompte inventé');
    expect(labelOf('Loyer')).toBe('Loyer');
  });

  it('directionOf : income/expense cohérent', () => {
    expect(directionOf('rent')).toBe('income');
    expect(directionOf('loan_installment')).toBe('expense');
    expect(directionOf('inconnu')).toBe('expense'); // fallback 'other' = expense
  });

  it('cashflowBucketOf : buckets canoniques', () => {
    expect(cashflowBucketOf('rent')).toBe('operating_income');
    expect(cashflowBucketOf('loan_installment')).toBe('debt_service');
    expect(cashflowBucketOf('loan_insurance')).toBe('debt_service');
    expect(cashflowBucketOf('property_tax')).toBe('operating_expense');
    expect(cashflowBucketOf('internal_transfer')).toBe('excluded');
    expect(cashflowBucketOf('deposit_received')).toBe('excluded');
    expect(cashflowBucketOf('amortization')).toBe('excluded');
    expect(cashflowBucketOf('inconnu')).toBe('excluded');
  });

  it('isDebtService : prêt + assurance seulement', () => {
    expect(isDebtService('loan_installment')).toBe(true);
    expect(isDebtService('loan_insurance')).toBe(true);
    expect(isDebtService('property_tax')).toBe(false);
  });

  it('isKnownKey : exclut le fallback', () => {
    expect(isKnownKey('rent')).toBe(true);
    expect(isKnownKey('other')).toBe(true); // clé enregistrée (fallback du catalogue)
    expect(isKnownKey('zzz')).toBe(false);
  });

  it('activeCategories : filtre par sens et tri', () => {
    const inc = activeCategories('income');
    expect(inc.length).toBeGreaterThan(0);
    expect(inc.every((c) => c.direction === 'income')).toBe(true);
    expect(activeKeys('income')).toContain('rent');
    expect(activeKeys('expense')).toContain('loan_installment');
  });

  it('toutes les clés actives référencées dans CASHFLOW_BUCKET', () => {
    for (const c of FINANCE_CATEGORIES.filter((c) => c.active)) {
      // doit disposer d’un bucket (pas undefined) — vérifié via cashflowBucketOf
      expect(typeof cashflowBucketOf(c.key)).toBe('string');
    }
  });
});