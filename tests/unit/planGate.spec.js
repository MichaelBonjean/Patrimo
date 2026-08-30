import { describe, it, expect } from 'vitest';
import {
  getEffectivePlan, canUseFeature, getPropertyLimit, canAddProperty,
  trialDaysLeft, PLAN_LIMITS,
} from '@/lib/planGate';

const DAY = 86400000;

describe('planGate — limites par plan', () => {
  it('utilisateur sans plan → starter (1 bien, pas de fonctions avancées)', () => {
    expect(getEffectivePlan({})).toBe('starter');
    expect(getPropertyLimit({})).toBe(1);
    expect(canUseFeature({}, 'quittances')).toBe(false);
    expect(canUseFeature({}, 'bank_connection')).toBe(false);
  });

  it('starter bloque le 2e bien', () => {
    const u = { plan: 'starter', subscription_status: 'none', created_date: '2020-01-01' };
    expect(canAddProperty(u, 0)).toBe(true);
    expect(canAddProperty(u, 1)).toBe(false);
    expect(canAddProperty(u, 2)).toBe(false);
  });

  it('pro autorise 5 biens + quittances + révisions', () => {
    const u = { plan: 'pro', subscription_status: 'active' };
    expect(getEffectivePlan(u)).toBe('pro');
    expect(getPropertyLimit(u)).toBe(5);
    expect(canUseFeature(u, 'quittances')).toBe(true);
    expect(canUseFeature(u, 'rent_revisions')).toBe(true);
    expect(canAddProperty(u, 4)).toBe(true);
    expect(canAddProperty(u, 5)).toBe(false);
  });

  it('business illimité + partage comptable + connexion bancaire', () => {
    const u = { plan: 'business', subscription_status: 'active' };
    expect(getPropertyLimit(u)).toBe(Infinity);
    expect(canAddProperty(u, 1000)).toBe(true);
    expect(canUseFeature(u, 'accountant_sharing')).toBe(true);
    expect(canUseFeature(u, 'bank_connection')).toBe(true);
  });
});

describe('planGate — essai inscription 14j', () => {
  it('essai actif (J+5) → accès business', () => {
    const u = { created_date: new Date(Date.now() - 5 * DAY).toISOString() };
    expect(getEffectivePlan(u)).toBe('business');
    const d = trialDaysLeft(u);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(10);
  });

  it('essai expiré (J+20) → starter', () => {
    const u = { created_date: new Date(Date.now() - 20 * DAY).toISOString() };
    expect(getEffectivePlan(u)).toBe('starter');
    expect(trialDaysLeft(u)).toBe(0);
  });
});

describe('planGate — statuts intermédiaires', () => {
  it('past_due conserve le plan courant (grace)', () => {
    const u = { plan: 'pro', subscription_status: 'past_due' };
    expect(getEffectivePlan(u)).toBe('pro');
    expect(canUseFeature(u, 'quittances')).toBe(true);
  });

  it('canceled conserve le plan jusqu\'à la fin de période', () => {
    const u = { plan: 'pro', subscription_status: 'canceled' };
    expect(getEffectivePlan(u)).toBe('pro');
  });
});