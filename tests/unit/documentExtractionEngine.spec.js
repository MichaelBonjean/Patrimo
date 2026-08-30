import { describe, it, expect } from 'vitest';
import {
  splitTextIntoPages, locateCandidatePages, buildExtractionTasks,
  taskResultToCandidates, mergeExtractionResults, equalValues,
  getSectionTargets, hasSectionTargets,
} from '@/lib/documentExtractionEngine';

describe('documentExtractionEngine — pagination', () => {
  it('splitTextIntoPages : découpe par form-feed', () => {
    const p = splitTextIntoPages('aaa\fbbb\fccc', 3);
    expect(p).toEqual(['aaa', 'bbb', 'ccc']);
  });
  it('splitTextIntoPages : découpe en N parts équivalentes si pas de form-feed', () => {
    const p = splitTextIntoPages('0123456789', 2);
    expect(p).toHaveLength(2);
    expect(p.join('')).toBe('0123456789');
  });
  it('splitTextIntoPages : texte vide → []', () => {
    expect(splitTextIntoPages('', 5)).toEqual([]);
  });
});

describe('documentExtractionEngine — recherche ciblée', () => {
  const pages = [
    'Page 1 : introduction et sommaire du document.',
    'Page 2 : objet social et dénomination sociale de la SCI.',
    'Page 27 : le prix de vente est de 250 000 euros, acquéreur M. Dupont.',
  ];

  it('locateCandidatePages : localise la page contenant le mot-clé (page 27)', () => {
    const c = locateCandidatePages(pages, ['prix de vente', 'acquereur']);
    expect(c.length).toBe(1);
    expect(c[0].page).toBe(3); // index 1-based
  });
  it('locateCandidatePages : classe par nombre de mots-clés touchés (décroissant)', () => {
    const c = locateCandidatePages(pages, ['denomination', 'objet social', 'sci']);
    expect(c[0].page).toBe(2); // page 2 touche 3 mots-clés
  });
  it('locateCandidatePages : plafonne à maxPages', () => {
    const c = locateCandidatePages(pages, ['page'], 1);
    expect(c.length).toBeLessThanOrEqual(1);
  });

  it('buildExtractionTasks : produit une tâche par section×page avec provenance', () => {
    const tasks = buildExtractionTasks({ classification: 'statuts_societe', pages });
    expect(tasks.length).toBeGreaterThan(0);
    const cap = tasks.find((t) => t.section === 'capital');
    expect(cap).toBeTruthy();
    expect(typeof cap.page).toBe('number');
    expect(typeof cap.source_text).toBe('string');
    expect(cap.fields).toContain('capital');
    expect(cap.json_schema.properties.capital).toBeDefined();
  });
  it('buildExtractionTasks : fallback page 1 si aucun mot-clé ne matche', () => {
    const tasks = buildExtractionTasks({ classification: 'statuts_societe', pages: ['rien de pertinent ici'] });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.page === 1)).toBe(true);
  });
  it('a des sections ciblées pour acte_vente, statuts_societe, offre_pret, tableau_amortissement', () => {
    expect(hasSectionTargets('acte_vente')).toBe(true);
    expect(hasSectionTargets('statuts_societe')).toBe(true);
    expect(hasSectionTargets('offre_pret')).toBe(true);
    expect(hasSectionTargets('tableau_amortissement')).toBe(true);
    expect(hasSectionTargets('quittance')).toBe(false);
    expect(getSectionTargets('acte_vente').some((t) => t.section === 'prix')).toBe(true);
  });
});

describe('documentExtractionEngine — taskResultToCandidates', () => {
  it('expose le champ, saute les null, fallback confiance 0.6', () => {
    const task = {
      section: 'prix', page: 27, source_text: 'src', fields: ['purchase_price', 'notary_fees'],
      prompt: '', json_schema: {}, matched_keywords: [],
    };
    const cands = taskResultToCandidates(task, { purchase_price: 250000, notary_fees: null, _confidence: { purchase_price: 0.9 } });
    expect(cands).toHaveLength(1);
    expect(cands[0].field).toBe('purchase_price');
    expect(cands[0].value).toBe(250000);
    expect(cands[0].confidence).toBe(0.9);
    expect(cands[0].page).toBe(27);
    expect(cands[0].source_text).toBe('src');
  });
  it('fallback confiance 0.6 si _confidence absent', () => {
    const task = { section: 's', page: 1, source_text: 'x', fields: ['rate'], prompt: '', json_schema: {}, matched_keywords: [] };
    expect(taskResultToCandidates(task, { rate: 3.2 })[0].confidence).toBe(0.6);
  });
});

describe('documentExtractionEngine — merge & conflits', () => {
  it('valeur unique → résolue + provenance (page 27)', () => {
    const merged = mergeExtractionResults({
      purchase_price: [{ value: 250000, confidence: 0.9, page: 27, source_text: 'prix 250000 page 27' }],
    });
    expect(merged.values.purchase_price).toBe(250000);
    expect(merged.confidences.purchase_price).toBe(0.9);
    expect(merged.provenance.purchase_price).toEqual({ page: 27, confidence: 0.9, source_text: 'prix 250000 page 27' });
    expect(merged.conflicts).toHaveLength(0);
  });

  it('valeurs identiques sur plusieurs pages → consensus (pas de conflit)', () => {
    const merged = mergeExtractionResults({
      rate: [
        { value: 3.2, confidence: 0.7, page: 5, source_text: 'taux 3.2' },
        { value: 3.2, confidence: 0.9, page: 12, source_text: 'taux 3.2 (bis)' },
      ],
    });
    expect(merged.values.rate).toBe(3.2);
    // La provenance retient la meilleure confiance.
    expect(merged.provenance.rate.page).toBe(12);
    expect(merged.conflicts).toHaveLength(0);
  });

  it('valeurs contradictoires → proposition de conflit, PAS de choix arbitraire', () => {
    const merged = mergeExtractionResults({
      purchase_price: [
        { value: 250000, confidence: 0.9, page: 27, source_text: 'prix 250000 page 27' },
        { value: 245000, confidence: 0.8, page: 4, source_text: 'prix 245000 page 4' },
      ],
    });
    expect(merged.values.purchase_price).toBeNull(); // pas de choix arbitraire
    expect(merged.conflicts).toHaveLength(1);
    const c = merged.conflicts[0];
    expect(c.field).toBe('purchase_price');
    expect(c.status).toBe('unresolved');
    expect(c.candidates).toHaveLength(2);
    // Chaque candidat conserve sa provenance exacte.
    expect(c.candidates.map((x) => x.page).sort((a, b) => a - b)).toEqual([4, 27]);
    expect(c.candidates.every((x) => typeof x.source_text === 'string')).toBe(true);
  });

  it('conflit sur tableau (array) détecté, pas de fusion arbitraire', () => {
    const merged = mergeExtractionResults({
      associates: [
        { value: [{ name: 'A', share_percent: 50 }], confidence: 0.7, page: 3, source_text: 's3' },
        { value: [{ name: 'A', share_percent: 60 }], confidence: 0.6, page: 9, source_text: 's9' },
      ],
    });
    expect(merged.values.associates).toBeNull();
    expect(merged.conflicts).toHaveLength(1);
  });

  it('equalValues : normalisation numérique / textuelle', () => {
    expect(equalValues(250000, 250000)).toBe(true);
    expect(equalValues('SCI Dupont', 'sci dupont ')).toBe(true);
    expect(equalValues(250000, 245000)).toBe(false);
    expect(equalValues(null, undefined)).toBe(true); // deux « absents »
  });
});