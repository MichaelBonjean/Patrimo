import { describe, it, expect } from 'vitest';
import {
  computeEconomicShare,
  computePropertyShare,
  computePropertyOwnershipBreakdown,
  detectCycles,
  findOrphanMembers,
} from '../../base44/shared/ownership.ts';

// Scénario : une SCI « SCI Dupont » détient un bien à 100 %.
// La SCI est détenue à 60 % par M. Dupont (personne physique) et 40 % par Mme Dupont.
const holders = [
  { id: 'sci', name: 'SCI Dupont', type: 'SCI', owner_id: 'a@x.com' },
  { id: 'jean', name: 'Jean Dupont', type: 'Personne physique', owner_id: 'a@x.com' },
  { id: 'marie', name: 'Marie Dupont', type: 'Personne physique', owner_id: 'a@x.com' },
];

const members = [
  { id: 'm1', parent_holder_id: 'sci', member_holder_id: 'jean', share_percent: 60 },
  { id: 'm2', parent_holder_id: 'sci', member_holder_id: 'marie', share_percent: 40 },
];

const propertyHolders = [{ id: 'ph1', property_id: 'prop', holder_id: 'sci', share_percent: 100 }];

describe('Ownership — SCI imbriquée et détention économique', () => {
  it('computeEconomicShare : personne = elle-même → 1', () => {
    expect(computeEconomicShare({ personId: 'jean', targetId: 'jean', members })).toBe(1);
  });

  it('computeEconomicShare : part de Jean dans la SCI = 60 %', () => {
    expect(computeEconomicShare({ personId: 'jean', targetId: 'sci', members })).toBeCloseTo(0.6, 6);
    expect(computeEconomicShare({ personId: 'marie', targetId: 'sci', members })).toBeCloseTo(0.4, 6);
  });

  it('computePropertyShare : part économique de Jean sur le bien = 60 %', () => {
    expect(computePropertyShare({ personId: 'jean', propertyId: 'prop', members, propertyHolders })).toBeCloseTo(0.6, 6);
    expect(computePropertyShare({ personId: 'marie', propertyId: 'prop', members, propertyHolders })).toBeCloseTo(0.4, 6);
    expect(computePropertyShare({ personId: 'inconnu', propertyId: 'prop', members, propertyHolders })).toBe(0);
  });

  it('computePropertyOwnershipBreakdown : répartit 60/40 et exclut les parts nulles', () => {
    const { rows } = computePropertyOwnershipBreakdown({ propertyId: 'prop', holders, members, propertyHolders });
    const jean = rows.find((r) => r.personId === 'jean');
    const marie = rows.find((r) => r.personId === 'marie');
    expect(jean.economic_percent).toBeCloseTo(60, 1);
    expect(marie.economic_percent).toBeCloseTo(40, 1);
    expect(rows.length).toBe(2);
  });

  it('détention directe en propre par deux personnes 50/50', () => {
    const ph = [
      { id: 'ph1', property_id: 'prop', holder_id: 'jean', share_percent: 50 },
      { id: 'ph2', property_id: 'prop', holder_id: 'marie', share_percent: 50 },
    ];
    expect(computePropertyShare({ personId: 'jean', propertyId: 'prop', members: [], propertyHolders: ph })).toBeCloseTo(0.5, 6);
  });

  it('détection de cycles dans le graphe des associés', () => {
    const cycMembers = [
      { id: 'c1', parent_holder_id: 'A', member_holder_id: 'B', share_percent: 100 },
      { id: 'c2', parent_holder_id: 'B', member_holder_id: 'A', share_percent: 100 },
    ];
    const warns = detectCycles(cycMembers);
    expect(warns.length).toBeGreaterThan(0);
  });

  it('findOrphanMembers : parent ou member introuvable', () => {
    const orphans = findOrphanMembers(
      [{ id: 'o', parent_holder_id: 'ghost', member_holder_id: 'also-ghost', share_percent: 10 }],
      [{ id: 'real', name: 'X' }],
    );
    expect(orphans.length).toBe(1);
    expect(orphans[0].missingParent).toBe(true);
  });
});