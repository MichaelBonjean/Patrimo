import { describe, it, expect } from 'vitest';
import {
  normalizeDescription,
  makeFingerprintSync,
  isProbableDuplicate,
  classifyDuplicate,
  descriptionSimilarity,
} from '../../base44/shared/bankTransactionEngine.ts';

describe('Dédoublonnage — fingerprint SHA-256 (backend sync)', () => {
  it('fingerprint déterministe et stable', () => {
    const input = { account_id: 'FR12', date: '2024-01-05', amount: 900, raw_description: 'VIR LOYER DUPONT' };
    const a = makeFingerprintSync(input);
    const b = makeFingerprintSync({ ...input });
    expect(a).toBe(b);
    expect(a.startsWith('sha256:')).toBe(true);
    expect(a.length).toBe(71); // 'sha256:' + 64 hex
  });

  it('fingerprint diffère si le montant change d’1 centime', () => {
    const a = makeFingerprintSync({ account_id: 'FR', date: '2024-01-05', amount: 900, raw_description: 'X' });
    const b = makeFingerprintSync({ account_id: 'FR', date: '2024-01-05', amount: 900.01, raw_description: 'X' });
    expect(a).not.toBe(b);
  });

  it('normalizeDescription : retire accents, chiffres, bruit (VIR/CB)', () => {
    expect(normalizeDescription('VIR DUPONT 05/01')).toBe('dupont');
    expect(normalizeDescription('CB *1234 CARREFOUR')).toBe('carrefour');
    expect(normalizeDescription('')).toBe('');
  });

  it('exact : même fingerprint → doublon exact', () => {
    const cand = {
      account_id: 'FR', date: '2024-01-05', amount: 900,
      raw_description: 'VIR DUPONT',
      fingerprint: makeFingerprintSync({ account_id: 'FR', date: '2024-01-05', amount: 900, raw_description: 'VIR DUPONT' }),
    };
    const existing = [{ ...cand, id: 'bt-1' }];
    const r = classifyDuplicate(cand, existing);
    expect(r.level).toBe('exact');
  });

  it('probable : même compte + montant + date proche + libellés similaires', () => {
    const cand = {
      account_id: 'FR', date: '2024-01-06', amount: 900,
      normalized_description: 'dupont loyer',
      fingerprint: makeFingerprintSync({ account_id: 'FR', date: '2024-01-06', amount: 900, raw_description: 'dupont loyer' }),
    };
    const existing = [{
      id: 'bt-1', account_id: 'FR', date: '2024-01-05', amount: 900,
      normalized_description: 'dupont loyer',
      fingerprint: 'sha256:autre',
    }];
    const r = classifyDuplicate(cand, existing);
    expect(r.level).toBe('probable');
  });

  it('unique : rien de proche', () => {
    const cand = {
      account_id: 'FR', date: '2024-01-05', amount: 900,
      normalized_description: 'loyer jean',
      fingerprint: 'sha256:a',
    };
    const existing = [{
      account_id: 'DE', date: '2023-06-01', amount: 50,
      normalized_description: 'electricite',
      fingerprint: 'sha256:b',
    }];
    expect(classifyDuplicate(cand, existing).level).toBeNull();
  });

  it('RÈGLE ABSOLUE : deux paiements même mois/catégorie/lot mais montants distincts → JAMAIS fusionnés', () => {
    // Deux loyers distincts même période/lot mais montants différents (800 et 700).
    const a = {
      account_id: 'FR', date: '2024-01-05', amount: 800,
      normalized_description: 'loyer duplex',
      fingerprint: makeFingerprintSync({ account_id: 'FR', date: '2024-01-05', amount: 800, raw_description: 'loyer duplex' }),
    };
    const b = {
      account_id: 'FR', date: '2024-01-05', amount: 700,
      normalized_description: 'loyer duplex',
      fingerprint: makeFingerprintSync({ account_id: 'FR', date: '2024-01-05', amount: 700, raw_description: 'loyer duplex' }),
    };
    // Montants distincts → ni exact, ni probable.
    const existing = [b];
    const r = classifyDuplicate(a, existing);
    expect(r.level).toBeNull();
  });

  it('isProbableDuplicate : compte différent → faux', () => {
    expect(
      isProbableDuplicate(
        { account_id: 'FR', amount: 900, date: '2024-01-05', normalized_description: 'x' },
        { account_id: 'DE', amount: 900, date: '2024-01-05', normalized_description: 'x' },
      ),
    ).toBe(false);
  });

  it('descriptionSimilarity : recouvrement de tokens', () => {
    expect(descriptionSimilarity('loyer dupont', 'dupont loyer')).toBeCloseTo(1, 1);
    expect(descriptionSimilarity('loyer', 'electricite')).toBe(0);
  });
});