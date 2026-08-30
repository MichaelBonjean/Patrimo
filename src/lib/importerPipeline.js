/**
 * Helpers purs pour la page « Importer des documents ».
 * Centralise : étapes du pipeline, libellés d'état, dédoublonnage,
 * exemples de documents acceptés. Aucune dépendance React → testable unitairement.
 * La file séquentielle (statuts/décisions/progression) vit désormais dans le
 * moteur canonique base44/shared/documentQueue.ts (réexporté via @/lib/documentQueue).
 */

import {
  QUEUED, UPLOADED, OCR_RUNNING, CLASSIFYING, EXTRACTING, PAUSED,
  AWAITING_REVIEW, COMMITTED, CANCELLED, FAILED, REJECTED,
  ACTIVE_TECHNICAL, QUEUEABLE,
} from '@/lib/documentQueue';

// Étapes ordonnées du pipeline d'ingestion (Document First).
export const STAGE_ORDER = [
  QUEUED, UPLOADED, OCR_RUNNING, CLASSIFYING, EXTRACTING,
  PAUSED, AWAITING_REVIEW, COMMITTED, CANCELLED, REJECTED, FAILED,
];

// Libellé humain + ton sémantique par statut DocumentImport.
export const STAGE_LABEL = {
  [QUEUED]: { label: 'En attente dans la file', tone: 'idle' },
  [UPLOADED]: { label: 'Document reçu', tone: 'idle' },
  [OCR_RUNNING]: { label: 'Lecture du document…', tone: 'running' },
  [CLASSIFYING]: { label: 'Identification du type…', tone: 'running' },
  [EXTRACTING]: { label: 'Extraction des informations…', tone: 'running' },
  [PAUSED]: { label: 'Analyse en pause', tone: 'paused' },
  [AWAITING_REVIEW]: { label: 'Analyse terminée — à vérifier', tone: 'review' },
  [COMMITTED]: { label: 'Enregistré', tone: 'done' },
  [CANCELLED]: { label: 'Analyse arrêtée', tone: 'cancelled' },
  [REJECTED]: { label: 'Rejeté', tone: 'warn' },
  [FAILED]: { label: 'Erreur', tone: 'error' },
};

// Libellé fin de l'étape technique (current_stage) pour la barre de progression.
export const STAGE_DETAIL = {
  queued: 'En file d’attente',
  ocr: 'Lecture du document',
  ocr_done: 'Document lu',
  classifying: 'Identification du type',
  extraction: 'Extraction des informations',
  merging: 'Synthèse des informations',
  awaiting_review: 'Analyse terminée',
  paused: 'En pause',
  cancelled: 'Arrêté',
  failed: 'Échec',
};

export function stageDetail(stage) {
  return STAGE_DETAIL[stage] || STAGE_LABEL[stage]?.label || '';
}

// Statuts actifs techniques (un seul à la fois par patrimoine).
export const ACTIVE_STATUSES = [...ACTIVE_TECHNICAL];
export const QUEUEABLE_STATUSES = [...QUEUEABLE];

// Groupes d'affichage de la page Importer documents.
export function groupImports(imports = []) {
  return {
    active: imports.filter((r) => ACTIVE_TECHNICAL.has(r.status)), // max 1
    queued: imports.filter((r) => QUEUEABLE.has(r.status)),
    toReview: imports.filter((r) => r.status === AWAITING_REVIEW),
    recent: imports.filter((r) =>
      [COMMITTED, CANCELLED, FAILED, REJECTED, PAUSED].includes(r.status)),
  };
}

// Étapes cochées pour l'affichage en checklist (cumul linéaire).
export function progressSteps(record) {
  const s = record?.status || UPLOADED;
  const idx = STAGE_ORDER.indexOf(s);
  const doneAfter = (step) => {
    const i = STAGE_ORDER.indexOf(step);
    return i !== -1 && idx > i && s !== FAILED && s !== REJECTED && s !== CANCELLED;
  };
  return [
    { key: 'received', label: 'Document reçu', ok: true },
    {
      key: 'classified',
      label: `Identifié : ${labelForClassification(record?.classification)}`,
      ok: doneAfter(OCR_RUNNING) && !!record?.classification,
    },
    {
      key: 'extracted',
      label: `${countExtracted(record)} information(s) trouvée(s)`,
      ok: doneAfter(EXTRACTING) && idx >= 4,
    },
    {
      key: 'review',
      label: needsReview(record) ? 'Vérification nécessaire' : 'Prêt à enregistrer',
      ok: s === AWAITING_REVIEW,
      warn: needsReview(record),
    },
    { key: 'committed', label: 'Enregistré', ok: s === COMMITTED },
  ];
}

// Confiance de classification insuffisante → l'UI propose une confirmation
// (non bloquante). distinct de needsReview() qui porte sur les champs extraits.
export function needsClassificationConfirm(record) {
  const conf = Number(record?.classification_confidence || 0);
  return !!record && record.status === AWAITING_REVIEW && conf < CONFIDENCE_THRESHOLD && !!record.classification && record.classification !== 'unknown';
}

export function needsReview(record) {
  if (!record) return false;
  if (record.status !== AWAITING_REVIEW) return false;
  const conf = Number(record.classification_confidence || 0);
  if (conf && conf < 0.85) return true;
  const perField = record.confidence_per_field || {};
  return Object.values(perField).some((c) => Number(c) < 0.85);
}

export function countExtracted(record) {
  const d = record?.extracted_data;
  if (!d || typeof d !== 'object') return 0;
  return Object.values(d).filter((v) => v !== null && v !== undefined && v !== '').length;
}

// Seuil de « confiance élevée » : en dessous, l'UI propose une confirmation
// non bloquante (jamais de blocage de l'import).
export const CONFIDENCE_THRESHOLD = 0.75;

const CLASS_LABELS = {
  bail_alur: 'Bail',
  acte_vente_notarie: 'Acte de vente',
  compromis: 'Compromis de vente',
  offre_pret_bancaire: 'Offre de prêt',
  tableau_amortissement: "Tableau d'amortissement",
  releve_bancaire: 'Relevé bancaire',
  releve_caf: 'Relevé CAF / APL',
  taxe_fonciere: 'Taxe foncière',
  diagnostic_technique: 'DPE',
  assurance_pno: 'Assurance PNO',
  appel_charges: 'Appel de charges',
  facture: 'Facture',
  sci_statuts_kbis: 'Statuts SCI',
  etat_des_lieux: 'État des lieux',
  quittance_loyer: 'Quittance',
  autre: 'Autre',
  unknown: 'Non classé',
};

export function labelForClassification(c) {
  return CLASS_LABELS[c] || (c ? c : 'Non classé');
}

export function dedupKey(file) {
  return `${file.name || ''}|${file.size || 0}`;
}

export function findDuplicates(files, existingImports) {
  const map = new Map();
  (existingImports || []).forEach((r) => {
    const k = `${r.file_name || ''}|${r.file_size || 0}`;
    if (!map.has(k)) map.set(k, r);
  });
  const dupes = [];
  (files || []).forEach((f) => {
    if (map.has(dedupKey(f))) dupes.push(f);
  });
  return dupes;
}

export const EXAMPLE_DOCS = [
  'Acte de vente', 'Compromis', 'Bail', 'État des lieux', 'Offre de prêt',
  "Tableau d'amortissement", 'Relevé bancaire', 'Relevé CAF', 'Taxe foncière',
  'DPE', 'Assurance PNO', 'Appel de charges', 'Facture', 'Statuts SCI',
];

export const ACCEPTED_MIME =
  '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt,.csv,.xlsx,application/pdf,image/*';

export function isAcceptable(file) {
  if (!file) return false;
  if (file.size > 20 * 1024 * 1024) return false;
  const n = (file.name || '').toLowerCase();
  return /\.(pdf|png|jpe?g|webp|docx?|txt|csv|xlsx)$/i.test(n);
}