/**
 * Tests de la matrice centralisée `FIELD_VALIDATION_RULES` et du `ConfidenceEngine`.
 *
 * Verrouille :
 *  1. La séparation confiance d'extraction / importance métier.
 *  2. HIGH_RISK = confirmation humaine obligatoire, même à confiance maximale.
 *  3. LOW / MEDIUM auto-valident au-dessus de leur seuil, sans confirmation.
 *  4. `requireUserConfirmation` l'emporte sur tout seuil.
 *  5. La provenance est conservée ; aucun statut humain n'est écrasé.
 *  6. Aucune logique de seuil ne vit ailleurs que dans FIELD_VALIDATION_RULES / LEVEL_RULES.
 */
import { describe, it, expect } from 'vitest';
import {
  ConfidenceEngine,
  confidenceEngine,
  FIELD_VALIDATION_RULES,
  LEVEL_RULES,
  resolveFieldRule,
  buildExtractedDatum,
  normalizeConfidence,
  isUserArbitrated,
} from '../../base44/shared/extractedData.ts';

describe('normalizeConfidence', () => {
  it('serre dans [0, 1]', () => {
    expect(normalizeConfidence(0.5)).toBe(0.5);
    expect(normalizeConfidence(1.2)).toBe(1);
    expect(normalizeConfidence(-0.3)).toBe(0);
    expect(normalizeConfidence(NaN)).toBe(0);
    expect(normalizeConfidence(undefined)).toBe(0);
  });
});

describe('LEVEL_RULES — valeurs par défaut', () => {
  it('LOW : seuil 0,75, auto autorisée, pas de confirmation', () => {
    expect(LEVEL_RULES.low).toEqual({
      autoValidateThreshold: 0.75,
      autoValidationAllowed: true,
      requireUserConfirmation: false,
    });
  });
  it('MEDIUM : seuil 0,90, auto autorisée, pas de confirmation', () => {
    expect(LEVEL_RULES.medium).toEqual({
      autoValidateThreshold: 0.9,
      autoValidationAllowed: true,
      requireUserConfirmation: false,
    });
  });
  it('HIGH : auto INTERDITE, confirmation obligatoire, plancher 0,995', () => {
    expect(LEVEL_RULES.high.autoValidationAllowed).toBe(false);
    expect(LEVEL_RULES.high.requireUserConfirmation).toBe(true);
    expect(LEVEL_RULES.high.autoValidateThreshold).toBe(0.995);
  });
});

describe('FIELD_VALIDATION_RULES — mappages métier', () => {
  it('LOW_RISK : banque, ville, notaire', () => {
    expect(FIELD_VALIDATION_RULES.bank_name.risk).toBe('low');
    expect(FIELD_VALIDATION_RULES.city.risk).toBe('low');
    expect(FIELD_VALIDATION_RULES.notary_name.risk).toBe('low');
    expect(FIELD_VALIDATION_RULES.pages_count.risk).toBe('low');
  });
  it('MEDIUM_RISK : surface, charges, contact', () => {
    expect(FIELD_VALIDATION_RULES.surface.risk).toBe('medium');
    expect(FIELD_VALIDATION_RULES.charges.risk).toBe('medium');
    expect(FIELD_VALIDATION_RULES.tenant_email.risk).toBe('medium');
  });
  it('HIGH_RISK : prix, capital, taux, durée, loyer, dépôt, dates bail, quote-part, régime', () => {
    for (const f of [
      'purchase_price',
      'loan_amount',
      'monthly_payment',
      'loan_rate',
      'duration_years',
      'rent_excluding_charges',
      'deposit',
      'date_start',
      'date_end',
      'share_percent',
      'owner_name',
      'tax_regime',
    ]) {
      expect(FIELD_VALIDATION_RULES[f].risk).toBe('high');
    }
  });
  it("loan_amount : surcharge explicite (seuil 0,995 + confirmation obligatoire)", () => {
    expect(FIELD_VALIDATION_RULES.loan_amount).toEqual({
      risk: 'high',
      label: 'Capital emprunté',
      autoValidateThreshold: 0.995,
      requireUserConfirmation: true,
    });
  });
});

describe('resolveFieldRule — fusion champ + niveau', () => {
  it('champ LOW hérite des valeurs du niveau low', () => {
    const r = resolveFieldRule('pages_count');
    expect(r.risk).toBe('low');
    expect(r.autoValidateThreshold).toBe(0.75);
    expect(r.requireUserConfirmation).toBe(false);
  });
  it('champ sans seuil explicite hérite du niveau (loan_rate → high → 0,995 + confirmation)', () => {
    const r = resolveFieldRule('loan_rate');
    expect(r.risk).toBe('high');
    expect(r.autoValidateThreshold).toBe(0.995);
    expect(r.requireUserConfirmation).toBe(true);
  });
  it('champ inconnu → medium (précaution)', () => {
    const r = resolveFieldRule('champ_inconnu');
    expect(r.risk).toBe('medium');
    expect(r.autoValidateThreshold).toBe(0.9);
    expect(r.requireUserConfirmation).toBe(false);
  });
});

describe('ConfidenceEngine.decide — séparation confiance / importance', () => {
  it('purchase_price conf 0.99 → needs_review (HIGH, confirmation obligatoire)', () => {
    const d = confidenceEngine.decide('purchase_price', 0.99);
    expect(d.status).toBe('needs_review');
    expect(d.riskLevel).toBe('high');
    expect(d.requireUserConfirmation).toBe(true);
  });
  it('purchase_price conf 1.0 reste needs_review (confirmation l emporte sur le seuil)', () => {
    expect(confidenceEngine.decide('purchase_price', 1).status).toBe('needs_review');
  });
  it('loan_amount conf 0.999 → needs_review malgré seuil 0,995 atteint (confirmation)', () => {
    const d = confidenceEngine.decide('loan_amount', 0.999);
    expect(d.threshold).toBe(0.995);
    expect(d.requireUserConfirmation).toBe(true);
    expect(d.status).toBe('needs_review');
  });
  it('surface conf 0.91 → auto_validated (MEDIUM >= 0,90)', () => {
    expect(confidenceEngine.decide('surface', 0.91).status).toBe('auto_validated');
  });
  it('surface conf 0.82 → needs_review (MEDIUM < 0,90)', () => {
    expect(confidenceEngine.decide('surface', 0.82).status).toBe('needs_review');
  });
  it('loan_rate 0.82 (M→ non, HIGH) → needs_review', () => {
    const d = confidenceEngine.decide('loan_rate', 0.82);
    expect(d.riskLevel).toBe('high');
    expect(d.status).toBe('needs_review');
  });
  it('pages_count conf 0.99 → auto_validated (LOW >= 0,75)', () => {
    expect(confidenceEngine.decide('pages_count', 0.99).status).toBe('auto_validated');
  });
  it('pages_count conf 0.6 → needs_review (LOW < 0,75)', () => {
    expect(confidenceEngine.decide('pages_count', 0.6).status).toBe('needs_review');
  });
  it('deux champs de confiance identique (0,99) → statuts differents (HIGH vs LOW)', () => {
    expect(confidenceEngine.decide('purchase_price', 0.99).status).toBe('needs_review');
    expect(confidenceEngine.decide('pages_count', 0.99).status).toBe('auto_validated');
  });
  it('un champ HIGH peut auto-valider s il surcharge requireUserConfirmation:false', () => {
    const engine = new ConfidenceEngine();
    engine.registerField('custom', {
      risk: 'high',
      autoValidateThreshold: 0.95,
      requireUserConfirmation: false,
    });
    expect(engine.decide('custom', 0.96).status).toBe('auto_validated');
    expect(engine.decide('custom', 0.9).status).toBe('needs_review');
  });
});

describe('ConfidenceEngine.evaluate — provenance et non-mutation', () => {
  it("renvoie une nouvelle donnée et préserve la provenance", () => {
    const src = buildExtractedDatum('loan_rate', '3,65%', {
      confidence: 0.82,
      normalized_value: 0.0365,
      source_document_id: 'doc_1',
      source_page: 2,
      source_text: "Taux : 3,65% (hors assurance)",
      extraction_method: 'llm',
    });
    const evaluated = confidenceEngine.evaluate(src);
    expect(evaluated.validation_status).toBe('needs_review');
    expect(evaluated.source_document_id).toBe('doc_1');
    expect(evaluated.source_page).toBe(2);
    expect(evaluated.source_text).toBe("Taux : 3,65% (hors assurance)");
    expect(evaluated.extraction_method).toBe('llm');
    expect(src.validation_status).toBe('needs_review');
    expect(evaluated).not.toBe(src);
  });

  it("auto-valide un champ MEDIUM très confiant", () => {
    const src = buildExtractedDatum('surface', 45, { confidence: 0.95 });
    expect(confidenceEngine.evaluate(src).validation_status).toBe('auto_validated');
  });

  it("respecte un statut déjà arbitré par l'humain (même HIGH)", () => {
    const src = buildExtractedDatum('purchase_price', 245000, {
      confidence: 0.99,
      validation_status: 'user_validated',
    });
    expect(confidenceEngine.evaluate(src).validation_status).toBe('user_validated');
  });
});

describe('ConfidenceEngine.evaluateBatch', () => {
  it("calcule le statut de chaque donnée sans perdre l'ordre ni la provenance", () => {
    const batch = [
      buildExtractedDatum('purchase_price', 245000, { confidence: 0.99, source_document_id: 'd' }),
      buildExtractedDatum('surface', 45, { confidence: 0.95, source_document_id: 'd' }),
      buildExtractedDatum('pages_count', 3, { confidence: 0.99, source_document_id: 'd' }),
    ];
    const out = confidenceEngine.evaluateBatch(batch);
    expect(out.map((d) => d.validation_status)).toEqual([
      'needs_review',
      'auto_validated',
      'auto_validated',
    ]);
    expect(out.every((d) => d.source_document_id === 'd')).toBe(true);
  });
});

describe('ConfidenceEngine.markValidated — transitions humaines', () => {
  it("valide (user_validated) en préservant la provenance", () => {
    const src = buildExtractedDatum('purchase_price', 245000, {
      confidence: 0.99,
      source_document_id: 'd',
      source_page: 1,
    });
    const v = confidenceEngine.markValidated(src, 'user_validated');
    expect(v.validation_status).toBe('user_validated');
    expect(v.source_document_id).toBe('d');
    expect(v.source_page).toBe(1);
  });
  it("corrige (user_corrected) en remplaçant la valeur", () => {
    const src = buildExtractedDatum('purchase_price', 240000, {
      confidence: 0.4,
      source_document_id: 'd',
    });
    const c = confidenceEngine.markValidated(src, 'user_corrected', 245000);
    expect(c.validation_status).toBe('user_corrected');
    expect(c.value).toBe(245000);
    expect(c.source_document_id).toBe('d');
  });
  it("rejette (rejected) en préservant la valeur brute pour audit", () => {
    const src = buildExtractedDatum('loan_rate', '3,65%', { confidence: 0.3, source_document_id: 'd' });
    const r = confidenceEngine.markValidated(src, 'rejected');
    expect(r.validation_status).toBe('rejected');
    expect(r.value).toBe('3,65%');
  });
});

describe('ConfidenceEngine — API unique / extension', () => {
  it("risque et seuil d'un champ connu", () => {
    expect(confidenceEngine.riskOf('purchase_price')).toBe('high');
    expect(confidenceEngine.thresholdFor('pages_count')).toBe(0.75);
    expect(confidenceEngine.labelOf('purchase_price')).toBe("Prix d'acquisition");
  });
  it("permet de surcharger les valeurs par défaut des niveaux", () => {
    const levels = { low: LEVEL_RULES.low, medium: LEVEL_RULES.medium, high: LEVEL_RULES.high };
    const engine = new ConfidenceEngine(FIELD_VALIDATION_RULES, {
      ...levels,
      low: { autoValidateThreshold: 0.5, autoValidationAllowed: true, requireUserConfirmation: false },
    });
    expect(engine.decide('pages_count', 0.6).status).toBe('auto_validated');
  });
});

describe('ConfidenceEngine — committabilité & revue', () => {
  const mk = (s) =>
    buildExtractedDatum('pages_count', 3, { confidence: 0.9, validation_status: s });
  it("isCommittable : auto_validated, user_validated, user_corrected → vrai", () => {
    expect(confidenceEngine.isCommittable(mk('auto_validated'))).toBe(true);
    expect(confidenceEngine.isCommittable(mk('user_validated'))).toBe(true);
    expect(confidenceEngine.isCommittable(mk('user_corrected'))).toBe(true);
    expect(confidenceEngine.isCommittable(mk('needs_review'))).toBe(false);
    expect(confidenceEngine.isCommittable(mk('rejected'))).toBe(false);
  });
  it("requiresReview n'est vrai que pour needs_review", () => {
    expect(confidenceEngine.requiresReview(mk('needs_review'))).toBe(true);
    expect(confidenceEngine.requiresReview(mk('auto_validated'))).toBe(false);
  });
});

describe('isUserArbitrated', () => {
  it("distingue les statuts finaux arbitrés par l'humain", () => {
    expect(isUserArbitrated('user_validated')).toBe(true);
    expect(isUserArbitrated('user_corrected')).toBe(true);
    expect(isUserArbitrated('rejected')).toBe(true);
    expect(isUserArbitrated('auto_validated')).toBe(false);
    expect(isUserArbitrated('needs_review')).toBe(false);
  });
});