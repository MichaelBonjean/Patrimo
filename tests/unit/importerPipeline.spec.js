import { describe, it, expect } from 'vitest';
import {
  STAGE_ORDER, STAGE_LABEL, progressSteps, needsReview, countExtracted,
  labelForClassification, dedupKey, findDuplicates, EXAMPLE_DOCS, isAcceptable,
} from '@/lib/importerPipeline';

describe('importerPipeline — étapes & libellés', () => {
  it('expose les étapes ordonnées du pipeline', () => {
    expect(STAGE_ORDER[0]).toBe('queued');
    expect(STAGE_ORDER.indexOf('awaiting_review')).toBeGreaterThan(STAGE_ORDER.indexOf('extracting'));
    expect(STAGE_LABEL.failed.tone).toBe('error');
  });

  it('labelForClassification renvoie un libellé lisible', () => {
    expect(labelForClassification('bail_alur')).toBe('Bail');
    expect(labelForClassification('offre_pret_bancaire')).toBe('Offre de prêt');
    expect(labelForClassification(undefined)).toBe('Non classé');
    expect(labelForClassification('inconnu')).toBe('inconnu');
  });
});

describe('importerPipeline — progression checklist', () => {
  it('document juste reçu : seule la première étape ok', () => {
    const steps = progressSteps({ status: 'uploaded', classification: null });
    expect(steps[0].ok).toBe(true);          // reçu
    expect(steps[1].ok).toBe(false);         // pas encore classé
    expect(steps[4].ok).toBe(false);         // pas enregistré
  });

  it('document awaiting_review fiable : prêt à enregistrer (pas de warn)', () => {
    const rec = {
      status: 'awaiting_review',
      classification: 'bail_alur',
      classification_confidence: 0.95,
      extracted_data: { tenant_name: 'Dupont', rent: 750, charges: 60 },
      confidence_per_field: { tenant_name: 0.98, rent: 0.97, charges: 0.9 },
    };
    const steps = progressSteps(rec);
    expect(steps[1].ok).toBe(true);  // classifié
    expect(steps[2].ok).toBe(true); // 3 infos trouvées
    expect(steps[3].ok).toBe(true); // prêt à valider
    expect(steps[3].warn).toBe(false);
    expect(needsReview(rec)).toBe(false);
  });

  it('awaiting_review avec confiance faible → vérification nécessaire', () => {
    const rec = {
      status: 'awaiting_review',
      classification: 'offre_pret_bancaire',
      classification_confidence: 0.82,
      extracted_data: { loan_amount: 180000 },
      confidence_per_field: { loan_amount: 0.82 },
    };
    expect(needsReview(rec)).toBe(true);
    const steps = progressSteps(rec);
    expect(steps[3].warn).toBe(true);
    expect(steps[3].label).toBe('Vérification nécessaire');
  });

  it('committed → étape enregistré ok', () => {
    const steps = progressSteps({ status: 'committed', classification: 'bail_alur', extracted_data: { a: 1 } });
    expect(steps[4].ok).toBe(true);
  });

  it('failed → ni classifié ni enregistré', () => {
    const steps = progressSteps({ status: 'failed', classification: null, error_message: 'OCR' });
    expect(steps[1].ok).toBe(false);
    expect(steps[4].ok).toBe(false);
  });
});

describe('importerPipeline — extraction', () => {
  it('compte les champs non vides du extracted_data', () => {
    // countExtracted attend un enregistrement DocumentImport.
    expect(countExtracted({ extracted_data: { a: 1, b: '', c: null, d: 0 } })).toBe(2);
    expect(countExtracted({ extracted_data: null })).toBe(0);
    expect(countExtracted({})).toBe(0);
    expect(countExtracted(null)).toBe(0);
  });
});

describe('importerPipeline — dédoublonnage', () => {
  const file = (name, size) => ({ name, size: size || 1024 });

  it('dedupKey combine nom + taille', () => {
    expect(dedupKey(file('a.pdf', 100))).toBe('a.pdf|100');
    expect(dedupKey(file('a.pdf', 101))).not.toBe(dedupKey(file('a.pdf', 100)));
  });

  it('findDuplicates repère les fichiers déjà importés', () => {
    const existing = [{ file_name: 'Bail.pdf', file_size: 2048 }];
    const files = [file('Bail.pdf', 2048), file('Acte.pdf', 4096)];
    const dupes = findDuplicates(files, existing);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].name).toBe('Bail.pdf');
  });

  it('findDuplicates vide si rien en commun', () => {
    expect(findDuplicates([file('x.pdf', 1)], [{ file_name: 'y.pdf', file_size: 2 }])).toHaveLength(0);
  });

  it('findDuplicates tolérant aux entrées vides', () => {
    expect(findDuplicates([], [])).toEqual([]);
    expect(findDuplicates([file('a', 1)], [])).toEqual([]);
  });
});

describe('importerPipeline — fichiers acceptables', () => {
  it('accepte PDF/image/xlsx sous 20 Mo', () => {
    expect(isAcceptable({ name: 'a.pdf', size: 1000 })).toBe(true);
    expect(isAcceptable({ name: 'b.JPG', size: 1 })).toBe(true);
    expect(isAcceptable({ name: 'c.xlsx', size: 1 })).toBe(true);
  });

  it('rejette > 20 Mo et extensions inconnues', () => {
    expect(isAcceptable({ name: 'a.pdf', size: 21 * 1024 * 1024 })).toBe(false);
    expect(isAcceptable({ name: 'a.exe', size: 1 })).toBe(false);
    expect(isAcceptable(null)).toBe(false);
  });
});

describe('importerPipeline — exemples', () => {
  it('expose une liste indicative non vide et lisible', () => {
    expect(EXAMPLE_DOCS.length).toBeGreaterThanOrEqual(8);
    expect(EXAMPLE_DOCS).toContain('Bail');
    expect(EXAMPLE_DOCS).toContain('Offre de prêt');
  });
});