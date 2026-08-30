import { describe, it, expect } from 'vitest';
import {
  computeLeaseStatus,
  isLeaseActiveAt,
  pickActiveLease,
  pickLeaseForPeriod,
  legacyLotSnapshot,
} from '../../base44/shared/leaseResolve.ts';

const today = '2024-06-15';

describe('leaseResolve — bails & changement de locataire', () => {
  it('computeLeaseStatus : futur / actif / termine', () => {
    expect(computeLeaseStatus({ date_start: '2024-09-01' }, today)).toBe('futur');
    expect(computeLeaseStatus({ date_start: '2024-01-01' }, today)).toBe('actif');
    expect(computeLeaseStatus({ date_start: '2023-01-01', date_end: '2024-03-31' }, today)).toBe('termine');
  });

  it('isLeaseActiveAt : bornes inclusives', () => {
    expect(isLeaseActiveAt({ date_start: '2024-01-01' }, '2024-06-15')).toBe(true);
    expect(isLeaseActiveAt({ date_start: '2024-07-01' }, '2024-06-15')).toBe(false);
    expect(isLeaseActiveAt({ date_start: '2024-01-01', date_end: '2024-06-15' }, '2024-06-15')).toBe(true);
    expect(isLeaseActiveAt({ date_start: '2024-01-01', date_end: '2024-06-14' }, '2024-06-15')).toBe(false);
  });

  it('pickActiveLease : le plus récent bail actif gagne en cas de chevauchement', () => {
    const leases = [
      { id: 'old', date_start: '2022-01-01', date_end: '2024-04-30' }, // terminé
      { id: 'new', date_start: '2024-05-01' }, // actif
    ];
    expect(pickActiveLease(leases, '2024-06-15')?.id).toBe('new');
  });

  it('changement de locataire : bail couvrant une période passée = ancien locataire', () => {
    const leases = [
      { id: 'old', date_start: '2022-01-01', date_end: '2024-04-30', tenants: [{ name: 'Ancien' }] },
      { id: 'new', date_start: '2024-05-01', tenants: [{ name: 'Nouveau' }] },
    ];
    expect(pickLeaseForPeriod(leases, 2024, 3)?.id).toBe('old');
    expect(pickLeaseForPeriod(leases, 2024, 5)?.id).toBe('new');
  });

  it('pickLeaseForPeriod : null si aucun bail ne couvre la période', () => {
    const leases = [{ id: 'x', date_start: '2024-01-01', date_end: '2024-04-30' }];
    expect(pickLeaseForPeriod(leases, 2024, 6)).toBeNull();
  });

  it('pickActiveLease : null si aucun bail actif', () => {
    const leases = [{ id: 'old', date_start: '2022-01-01', date_end: '2024-04-30' }];
    expect(pickActiveLease(leases, '2024-06-15')).toBeNull();
  });

  it('legacyLotSnapshot : reconstruit un bail à partir des champs legacy du lot', () => {
    const lot = { tenant_name: 'Jean Dupont', tenant_entry_date: '2023-01-01', rent_excluding_charges: 800, charges: 50 };
    const snap = legacyLotSnapshot(lot, { name: 'Immeuble' });
    expect(snap.tenants[0].name).toBe('Jean Dupont');
    expect(snap.rent_excluding_charges).toBe(800);
    expect(snap.charges).toBe(50);
    expect(snap._legacy).toBe(true);
  });
});