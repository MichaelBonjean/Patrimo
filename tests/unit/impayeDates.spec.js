import { describe, it, expect } from 'vitest';
import { lateDays } from '../../base44/shared/impayeEngine.ts';

describe('impayeEngine — jours de retard (pure)', () => {
  it('lateDays : échéance il y a 10 jours', () => {
    expect(lateDays('2024-01-05', '2024-01-15')).toBe(10);
  });

  it('lateDays : 0 si avant l’échéance', () => {
    expect(lateDays('2024-01-05', '2024-01-01')).toBe(0);
  });

  it('lateDays : 0 si date manquante', () => {
    expect(lateDays('', '2024-01-15')).toBe(0);
    expect(lateDays('2024-01-05', '')).toBe(0);
  });

  it('lateDays : année bissextile (29/02)', () => {
    expect(lateDays('2024-02-29', '2024-03-01')).toBe(1);
  });
});