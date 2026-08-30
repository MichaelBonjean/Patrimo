import { describe, it, expect } from 'vitest';
import {
  getActiveLeaseForLot,
  getLeaseAtDate,
  getCurrentTenants,
  getMonthlyRentForLot,
  getMonthlyChargesForLot,
  currentRentHC,
  pickLeaseForPeriod,
  effectiveRent,
} from '@/lib/lease';

// Scénario de référence :
//   Lot legacy  : ancien locataire, loyer HC 700 €, charges 100 €, depuis 2024-01-01.
//   Lease actif : nouveau locataire depuis 2026-06-01, loyer HC 760 €, charges 120 €.
// Règle : à la période couverte par le nouveau bail → 760 €. Avant → repli legacy 700 €.
const LOT = {
  id: 'lot-1',
  designation: 'App. T2',
  rent_excluding_charges: 700,
  charges: 100,
  tenant_name: 'Ancien Locataire',
  tenant_entry_date: '2024-01-01',
};
const LEASE_NEW = {
  id: 'lease-1',
  lot_id: 'lot-1',
  date_start: '2026-06-01',
  status: 'actif',
  rent_excluding_charges: 760,
  charges: 120,
  tenants: [{ id: 'tn1', name: 'Nouveau Locataire', entry_date: '2026-06-01' }],
};
const LEASES = [LEASE_NEW];

describe('Migration Lot → Lease — helpers canoniques', () => {
  it('getMonthlyRentForLot renvoie 760 € sur la période du nouveau bail', () => {
    expect(getMonthlyRentForLot('lot-1', LEASES, 2026, 7)).toBe(760);
    expect(getMonthlyRentForLot('lot-1', LEASES, 2026, 8)).toBe(760);
  });

  it('getMonthlyRentForLot renvoie null avant le bail (repli legacy 700 €)', () => {
    expect(getMonthlyRentForLot('lot-1', LEASES, 2026, 3)).toBeNull();
    expect(getMonthlyRentForLot('lot-1', LEASES, 2025, 12)).toBeNull();
  });

  it('getMonthlyChargesForLot renvoie 120 € sur le bail, null avant', () => {
    expect(getMonthlyChargesForLot('lot-1', LEASES, 2026, 7)).toBe(120);
    expect(getMonthlyChargesForLot('lot-1', LEASES, 2026, 3)).toBeNull();
  });

  it('getActiveLeaseForLot renvoie le bail actif aujourd’hui (post 2026-06-01)', () => {
    const a = getActiveLeaseForLot('lot-1', LEASES, '2026-08-25');
    expect(a?.id).toBe('lease-1');
    expect(a.rent_excluding_charges).toBe(760);
  });

  it('getActiveLeaseForLot renvoie null avant le démarrage du bail', () => {
    expect(getActiveLeaseForLot('lot-1', LEASES, '2026-01-15')).toBeNull();
  });

  it('getLeaseAtDate = getActiveLeaseForLot à une date arbitraire', () => {
    expect(getLeaseAtDate('lot-1', LEASES, '2026-07-10')?.id).toBe('lease-1');
    expect(getLeaseAtDate('lot-1', LEASES, '2026-01-10')).toBeNull();
  });

  it('getCurrentTenants renvoie le nouveau locataire sur le bail', () => {
    const ts = getCurrentTenants('lot-1', LEASES, '2026-08-25');
    expect(ts).toHaveLength(1);
    expect(ts[0].name).toBe('Nouveau Locataire');
  });

  it('getCurrentTenants renvoie [] avant le bail (pas de locataire legacy via Lease)', () => {
    expect(getCurrentTenants('lot-1', LEASES, '2026-01-15')).toEqual([]);
  });

  it('currentRentHC utilise le bail sur la période courante, repli legacy avant', () => {
    expect(currentRentHC(LOT, LEASES, '2026-08-25')).toBe(760);
    expect(currentRentHC(LOT, LEASES, '2025-12-15')).toBe(700);
  });

  it('pickLeaseForPeriod sélectionne le bail couvrant le mois', () => {
    expect(pickLeaseForPeriod(LEASES, 2026, 6)?.id).toBe('lease-1');
    expect(pickLeaseForPeriod(LEASES, 2026, 1)).toBeNull();
  });

  it('effectiveRent (legacy helper) reste cohérent : bail actif gagne', () => {
    expect(effectiveRent(LOT, LEASES)).toBe(760);
  });
});

describe('Migration Lot → Lease — scénario multi-baux (historique préservé)', () => {
  const LOT2 = { id: 'lot-2', rent_excluding_charges: 700, charges: 90 };
  const LEASE_OLD = {
    id: 'lo', lot_id: 'lot-2', date_start: '2024-01-01', date_end: '2026-05-31',
    status: 'termine', rent_excluding_charges: 700, charges: 90,
    tenants: [{ id: 'to', name: 'Ancien', entry_date: '2024-01-01', exit_date: '2026-05-31' }],
  };
  const LEASE_NEW2 = {
    id: 'ln', lot_id: 'lot-2', date_start: '2026-06-01', status: 'actif',
    rent_excluding_charges: 760, charges: 110,
    tenants: [{ id: 'tn', name: 'Nouveau', entry_date: '2026-06-01' }],
  };
  const ALL = [LEASE_OLD, LEASE_NEW2];

  it('mois de mars 2026 → ancien bail 700 €', () => {
    expect(getMonthlyRentForLot('lot-2', ALL, 2026, 3)).toBe(700);
  });
  it('mois de juillet 2026 → nouveau bail 760 €', () => {
    expect(getMonthlyRentForLot('lot-2', ALL, 2026, 7)).toBe(760);
  });
  it('locataire actif en mars 2026 = Ancien, en août 2026 = Nouveau', () => {
    expect(getCurrentTenants('lot-2', ALL, '2026-03-15')[0]?.name).toBe('Ancien');
    expect(getCurrentTenants('lot-2', ALL, '2026-08-25')[0]?.name).toBe('Nouveau');
  });
});