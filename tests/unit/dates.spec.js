import { describe, it, expect } from 'vitest';
import { addMonthsClamped } from '../../base44/shared/loanEngine.ts';
import { addMonths, dueDateFor, monthKey } from '../../base44/shared/rentLedger.ts';
import { isoDate } from '../../base44/shared/bankTransactionEngine.ts';

describe('Dates — débordement, fin de mois, parsing', () => {
  it('addMonthsClamped : 31/01 + 1 mois → 29/02 (2024 bissextile)', () => {
    expect(addMonthsClamped('2024-01-31', 1)).toEqual(new Date(2024, 1, 29));
  });

  it('addMonthsClamped : 31/01/2023 + 1 mois → 28/02 (non bissextile)', () => {
    expect(addMonthsClamped('2023-01-31', 1)).toEqual(new Date(2023, 1, 28));
  });

  it('addMonthsClamped : 31/03 + 1 mois → 30/04 (pas de débordement vers 01/05)', () => {
    expect(addMonthsClamped('2023-03-31', 1)).toEqual(new Date(2023, 3, 30));
  });

  it('addMonthsClamped : 31/10 + 1 mois → 30/11', () => {
    expect(addMonthsClamped('2023-10-31', 1)).toEqual(new Date(2023, 10, 30));
  });

  it('addMonthsClamped : 30/01 + 1 mois → 29/02 (2024)', () => {
    expect(addMonthsClamped('2024-01-30', 1)).toEqual(new Date(2024, 1, 29));
  });

  it('addMonthsClamped : 31/01 + 2 mois → 31/03 (pas de clamp indu)', () => {
    expect(addMonthsClamped('2024-01-31', 2)).toEqual(new Date(2024, 2, 31));
  });

  it('rentLedger.addMonths : décalage de mois (année, mois)', () => {
    expect(addMonths(2024, 12, 1)).toEqual({ year: 2025, month: 1 });
    expect(addMonths(2024, 1, -1)).toEqual({ year: 2023, month: 12 });
  });

  it('rentLedger.dueDateFor : clamp au dernier jour du mois', () => {
    expect(dueDateFor(2024, 2, 31)).toBe('2024-02-29');
    expect(dueDateFor(2023, 2, 31)).toBe('2023-02-28');
    expect(dueDateFor(2024, 1, 5)).toBe('2024-01-05');
  });

  it('rentLedger.monthKey : YYYY-MM', () => {
    expect(monthKey(2024, 3)).toBe('2024-03');
  });

  it('bankTransactionEngine.isoDate : dd/mm/yyyy → ISO', () => {
    expect(isoDate('05/01/2024')).toBe('2024-01-05');
    expect(isoDate('2024-01-05')).toBe('2024-01-05');
  });
});