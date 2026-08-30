// Taxonomie canonique et STABLE des documents Patrimo.
//
// Source unique des :
//  - clés de classification (DocumentImport.classification) ;
//  - libellés / domaines / icônes / processeur / risque ;
//  - mapping classification → type de Document cofré (Document.type) ;
//  - familles juridiques (société) ;
//  - normalisation des clés legacy → canoniques (backward-compat) ;
//  - migration des documents historiquement mal classés.
//
// CRITÈRE : « Statuts SCI ne doivent jamais être catégorisés comme AG
// copropriété. » La table COFFRE_TYPE_BY_CLASSIFICATION mappe toute la
// famille SOCIÉTÉ → 'societe' (jamais 'ag_copropriete').
//
// PUR (aucun import plateforme) -> testable unitairement, partagé frontend
// (miroir src/lib/documentTypes.js) et backend (base44/shared).

export type Domain =
  | 'ACQUISITION' | 'LOCATION' | 'FINANCEMENT' | 'BANQUE'
  | 'SOCIÉTÉ' | 'FISCALITÉ' | 'COPROPRIÉTÉ' | 'AUTRES';

export type Risk = 'low' | 'medium' | 'high';

export interface DocumentTypeMeta {
  key: string;
  label: string;
  domain: Domain;
  icon: string;            // nom d'icône lucide-react (sans import ici)
  processor: string;       // processeur de commit (bail/acte/loan/legal_entity/dpe/quittance/bank/none)
  risk: Risk;
  accepted_for_auto_processing: boolean;
  coffre: string;          // Document.type cofré cible
  legacy_aliases?: string[]; // clés historiques équivalentes (migration 1:1 certaine)
}

export const DOMAINS: { key: Domain; label: string; icon: string }[] = [
  { key: 'ACQUISITION', label: 'Acquisition', icon: 'Home' },
  { key: 'LOCATION', label: 'Location', icon: 'KeyRound' },
  { key: 'FINANCEMENT', label: 'Financement', icon: 'Landmark' },
  { key: 'BANQUE', label: 'Banque', icon: 'Banknote' },
  { key: 'SOCIÉTÉ', label: 'Société', icon: 'Building2' },
  { key: 'FISCALITÉ', label: 'Fiscalité', icon: 'Percent' },
  { key: 'COPROPRIÉTÉ', label: 'Copropriété', icon: 'Building' },
  { key: 'AUTRES', label: 'Autres', icon: 'FileQuestion' },
];

export const DOCUMENT_TYPES: DocumentTypeMeta[] = [
  // --- ACQUISITION ---
  { key: 'acte_vente', label: "Acte de vente notarié", domain: 'ACQUISITION', icon: 'FileSignature', processor: 'acte_de_vente', risk: 'high', accepted_for_auto_processing: false, coffre: 'acte', legacy_aliases: ['acte_vente_notarie'] },
  { key: 'compromis', label: "Compromis de vente", domain: 'ACQUISITION', icon: 'FileText', processor: 'none', risk: 'high', accepted_for_auto_processing: false, coffre: 'acte' },

  // --- LOCATION ---
  { key: 'bail', label: 'Bail (ALUR)', domain: 'LOCATION', icon: 'KeyRound', processor: 'lease', risk: 'high', accepted_for_auto_processing: false, coffre: 'bail', legacy_aliases: ['bail_alur'] },
  { key: 'etat_des_lieux', label: 'État des lieux', domain: 'LOCATION', icon: 'ClipboardCheck', processor: 'none', risk: 'medium', accepted_for_auto_processing: false, coffre: 'etat_des_lieux' },
  { key: 'quittance', label: 'Quittance de loyer', domain: 'LOCATION', icon: 'Receipt', processor: 'quittance', risk: 'low', accepted_for_auto_processing: true, coffre: 'quittance', legacy_aliases: ['quittance_loyer'] },

  // --- FINANCEMENT ---
  { key: 'offre_pret', label: 'Offre de prêt bancaire', domain: 'FINANCEMENT', icon: 'Landmark', processor: 'loan', risk: 'high', accepted_for_auto_processing: false, coffre: 'pret', legacy_aliases: ['offre_pret_bancaire'] },
  { key: 'tableau_amortissement', label: "Tableau d'amortissement", domain: 'FINANCEMENT', icon: 'Calculator', processor: 'loan', risk: 'high', accepted_for_auto_processing: false, coffre: 'pret' },

  // --- BANQUE ---
  { key: 'releve_bancaire', label: 'Relevé bancaire', domain: 'BANQUE', icon: 'Banknote', processor: 'bank', risk: 'low', accepted_for_auto_processing: false, coffre: 'releve_bancaire' },
  { key: 'releve_caf', label: 'Relevé CAF / APL', domain: 'BANQUE', icon: 'Home', processor: 'none', risk: 'low', accepted_for_auto_processing: false, coffre: 'autre' },

  // --- SOCIÉTÉ (jamais AG copropriété) ---
  { key: 'statuts_societe', label: 'Statuts de société', domain: 'SOCIÉTÉ', icon: 'Building2', processor: 'legal_entity', risk: 'high', accepted_for_auto_processing: false, coffre: 'societe', legacy_aliases: ['sci_statuts_kbis'] },
  { key: 'kbis_societe', label: 'Kbis / Extrait RCS', domain: 'SOCIÉTÉ', icon: 'BadgeCheck', processor: 'legal_entity', risk: 'medium', accepted_for_auto_processing: false, coffre: 'societe' },
  { key: 'cession_parts', label: 'Cession de parts', domain: 'SOCIÉTÉ', icon: 'ArrowLeftRight', processor: 'legal_entity', risk: 'high', accepted_for_auto_processing: false, coffre: 'societe' },
  { key: 'pv_societe', label: "PV d'assemblée", domain: 'SOCIÉTÉ', icon: 'Users', processor: 'legal_entity', risk: 'high', accepted_for_auto_processing: false, coffre: 'societe', legacy_aliases: ['pv_assemblee'] },
  { key: 'augmentation_capital', label: 'Augmentation de capital', domain: 'SOCIÉTÉ', icon: 'TrendingUp', processor: 'legal_entity', risk: 'high', accepted_for_auto_processing: false, coffre: 'societe' },
  { key: 'reduction_capital', label: 'Réduction de capital', domain: 'SOCIÉTÉ', icon: 'TrendingDown', processor: 'legal_entity', risk: 'high', accepted_for_auto_processing: false, coffre: 'societe' },
  { key: 'beneficiaires_effectifs', label: 'Bénéficiaires effectifs (RBE)', domain: 'SOCIÉTÉ', icon: 'UserCheck', processor: 'legal_entity', risk: 'high', accepted_for_auto_processing: false, coffre: 'societe' },

  // --- FISCALITÉ ---
  { key: 'taxe_fonciere', label: 'Taxe foncière', domain: 'FISCALITÉ', icon: 'Percent', processor: 'none', risk: 'medium', accepted_for_auto_processing: false, coffre: 'taxe_fonciere' },
  { key: 'avis_impot', label: "Avis d'imposition", domain: 'FISCALITÉ', icon: 'ReceiptText', processor: 'none', risk: 'medium', accepted_for_auto_processing: false, coffre: 'avis_impot' },

  // --- COPROPRIÉTÉ ---
  { key: 'ag_copropriete', label: 'AG de copropriété', domain: 'COPROPRIÉTÉ', icon: 'Building', processor: 'none', risk: 'low', accepted_for_auto_processing: false, coffre: 'ag_copropriete' },
  { key: 'appel_charges', label: 'Appel de charges', domain: 'COPROPRIÉTÉ', icon: 'Coins', processor: 'none', risk: 'low', accepted_for_auto_processing: false, coffre: 'ag_copropriete' },
  { key: 'decompte_charges', label: 'Décompte de charges', domain: 'COPROPRIÉTÉ', icon: 'Split', processor: 'none', risk: 'low', accepted_for_auto_processing: false, coffre: 'ag_copropriete' },

  // --- AUTRES ---
  { key: 'dpe', label: 'Diagnostic DPE', domain: 'AUTRES', icon: 'Gauge', processor: 'dpe', risk: 'low', accepted_for_auto_processing: true, coffre: 'dpe', legacy_aliases: ['diagnostic_technique'] },
  { key: 'assurance', label: 'Assurance PNO', domain: 'AUTRES', icon: 'ShieldCheck', processor: 'none', risk: 'medium', accepted_for_auto_processing: false, coffre: 'assurance', legacy_aliases: ['assurance_pno'] },
  { key: 'facture', label: 'Facture', domain: 'AUTRES', icon: 'Receipt', processor: 'none', risk: 'low', accepted_for_auto_processing: false, coffre: 'facture' },
  { key: 'autre', label: 'Autre document', domain: 'AUTRES', icon: 'FileQuestion', processor: 'none', risk: 'medium', accepted_for_auto_processing: false, coffre: 'autre' },
  { key: 'unknown', label: 'Non classé', domain: 'AUTRES', icon: 'FileQuestion', processor: 'none', risk: 'medium', accepted_for_auto_processing: false, coffre: 'autre' },
];

export const DOCUMENT_TYPE_BY_KEY: Record<string, DocumentTypeMeta> = Object.fromEntries(
  DOCUMENT_TYPES.map((t) => [t.key, t]),
);

export const CLASSIFICATION_TYPES: string[] = DOCUMENT_TYPES.map((t) => t.key);

// Famille juridique : documents de société gérés par le LegalEntityDocumentProcessor.
export const LEGAL_ENTITY_TYPES: Set<string> = new Set(
  DOCUMENT_TYPES.filter((t) => t.domain === 'SOCIÉTÉ').map((t) => t.key),
);

export function isLegalEntityClassification(key: string): boolean {
  return LEGAL_ENTITY_TYPES.has(normalizeClassification(key));
}

// --- Libellés (classification) ------------------------------------------------
export const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  DOCUMENT_TYPES.map((t) => [t.key, t.label]),
);

export function labelForClassification(key: string): string {
  const k = normalizeClassification(key);
  return TYPE_LABELS[k] || key || 'Document';
}

// --- Mapping classification → type de Document cofré --------------------------
// Critère majeur : la famille SOCIÉTÉ → 'societe' (JAMAIS 'ag_copropriete').
export const COFFRE_TYPE_BY_CLASSIFICATION: Record<string, string> = Object.fromEntries(
  DOCUMENT_TYPES.map((t) => [t.key, t.coffre]),
);

export function coffreTypeForClassification(key: string): string {
  return COFFRE_TYPE_BY_CLASSIFICATION[normalizeClassification(key)] || 'autre';
}

// --- Normalisation legacy → canonique ----------------------------------------
// Construit la map legacy → canonique depuis les `legacy_aliases` de chaque type.
export const LEGACY_TO_CANONICAL: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const t of DOCUMENT_TYPES) {
    for (const alias of t.legacy_aliases || []) m[alias] = t.key;
  }
  return m;
})();

// Toutes les clés connues (canoniques + legacy) pour validation d'entrée.
export const ALL_KNOWN_CLASSIFICATIONS: Set<string> = new Set([
  ...CLASSIFICATION_TYPES,
  ...Object.keys(LEGACY_TO_CANONICAL),
]);

export function normalizeClassification(key: string | null | undefined): string {
  if (!key) return 'unknown';
  if (DOCUMENT_TYPE_BY_KEY[key]) return key;
  if (LEGACY_TO_CANONICAL[key]) return LEGACY_TO_CANONICAL[key];
  return 'autre';
}

export function isLegacyClassification(key: string | null | undefined): boolean {
  return !!key && !!LEGACY_TO_CANONICAL[key];
}

// --- Accès meta ---------------------------------------------------------------
export function getDocumentType(key: string): DocumentTypeMeta | undefined {
  return DOCUMENT_TYPE_BY_KEY[normalizeClassification(key)];
}

export function domainOf(key: string): Domain | undefined {
  return getDocumentType(key)?.domain;
}

export function iconOf(key: string): string {
  return getDocumentType(key)?.icon || 'FileQuestion';
}

export function processorOf(key: string): string {
  return getDocumentType(key)?.processor || 'none';
}

export function isAutoProcessable(key: string): boolean {
  return !!getDocumentType(key)?.accepted_for_auto_processing;
}

// --- Migration des documents historiquement mal classés -----------------------
// « Ne pas modifier automatiquement des données historiques ambiguës. Pour les
//  mappings certains : migrer. Pour les autres : conserver / marquer review_needed. »

export interface MigrationDecision {
  action: 'migrate' | 'keep' | 'review';
  from?: string;          // classification legacy source (action='migrate')
  to: string;             // classification canonique cible
  reason?: string;
}

/** Décision de migration pour une classification stockée (DocumentImport). */
export function classifyMigration(classification: string | null | undefined): MigrationDecision {
  const raw = classification || 'unknown';
  const canonical = normalizeClassification(raw);
  if (LEGACY_TO_CANONICAL[raw]) {
    return { action: 'migrate', from: raw, to: canonical, reason: `clé legacy « ${raw} » → canonique « ${canonical} »` };
  }
  return { action: 'keep', to: canonical };
}

/**
 * Décision de migration pour le TYPE de Document cofré (Document.type).
 * Critère majeur : un document cofré en 'ag_copropriete' peut en réalité être
 * un document de société (statuts SCI…) historiquement mal classé. Incertitude
 * → on NE ré-écrit pas automatiquement (ambigu) : on signale en review_needed.
 * Les types certains (société directement posés via la nouvelle table) sont
 * conservés.
 */
export function needsReviewCoffre(docType: string | null | undefined): boolean {
  return docType === 'ag_copropriete';
}