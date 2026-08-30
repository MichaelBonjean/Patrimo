import { describe, it, expect } from 'vitest';
import { pickActiveLease, pickLeaseForPeriod } from '../../base44/shared/leaseResolve.ts';

// Intégration : changement de locataire — le moteur de bails résout le bon
// locataire selon la période (ancien bail terminé, nouveau bail actif).
describe('INTÉGRATION — changement de locataire', () => {
  const leases = [
    { id: 'old', date_start: '2022-09-01', date_end: '2024-04-30', tenants: [{ name: 'Ancien', email: 'ancien@x.com' }] },
    { id: 'new', date_start: '2024-05-01', tenants: [{ name: 'Nouveau', email: 'nouveau@x.com', entry_date: '2024-05-01' }] },
  ];

  it('bail actif aujourd’hui = nouveau locataire', () => {
    const active = pickActiveLease(leases, '2024-06-15');
    expect(active.id).toBe('new');
    expect(active.tenants[0].name).toBe('Nouveau');
  });

  it('période passée (avant sortie de l’ancien) → ancien locataire', () => {
    const past = pickLeaseForPeriod(leases, 2024, 3);
    expect(past.id).toBe('old');
    expect(past.tenants[0].name).toBe('Ancien');
  });

  it('période après l’arrivée du nouveau → nouveau locataire', () => {
    const now = pickLeaseForPeriod(leases, 2024, 5);
    expect(now.tenants[0].name).toBe('Nouveau');
  });

  it('à la permutation (avril 2024) → l’ancien bail couvre encore la période', () => {
    // L’ancien bail se termine le 30/04, le nouveau démarre le 01/05.
    expect(pickLeaseForPeriod(leases, 2024, 4).id).toBe('old');
    expect(pickLeaseForPeriod(leases, 2024, 5).id).toBe('new');
  });

  it('aucun bail actif avant le premier → null', () => {
    expect(pickActiveLease(leases, '2021-01-01')).toBeNull();
  });
});