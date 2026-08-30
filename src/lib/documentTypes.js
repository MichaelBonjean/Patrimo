// Miroir JS (parité src/lib ↔ base44/shared) de base44/shared/documentTypes.ts.
// Taxonomie canonique et STABLE des documents Patrimo — source unique des clés
// de classification, libellés, domaines, icônes, processeurs, risques, mapping
// classification→coffre et migration legacy.
//
// Critère : « Statuts SCI ne doivent jamais être catégorisés comme AG
// copropriété. » => la famille SOCIÉTÉ → 'societe' (jamais 'ag_copropriete').

export const DOMAINS = [
  { key: 'ACQUISITION', label: 'Acquisition', icon: 'Home' },
  { key: 'LOCATION', label: 'Location', icon: 'KeyRound' },
  { key: 'FINANCEMENT', label: 'Financement', icon: 'Landmark' },
  { key: 'BANQUE', label: 'Banque', icon: 'Banknote' },
  { key: 'SOCIÉTÉ', label: 'Société', icon: 'Building2' },
  { key: 'FISCALITÉ', label: 'Fiscalité', icon: 'Percent' },
  { key: 'COPROPRIÉTÉ', label: 'Copropriété', icon: 'Building' },
  { key: 'AUTRES', label: 'Autres', icon: 'FileQuestion' },
];

export const DOCUMENT_TYPES = [
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

export const DOCUMENT_TYPE_BY_KEY = Object.fromEntries(
  DOCUMENT_TYPES.map((t) => [t.key, t]),
);

export const CLASSIFICATION_TYPES = DOCUMENT_TYPES.map((t) => t.key);

export const LEGAL_ENTITY_TYPES = new Set(
  DOCUMENT_TYPES.filter((t) => t.domain === 'SOCIÉTÉ').map((t) => t.key),
);

export function isLegalEntityClassification(key) {
  return LEGAL_ENTITY_TYPES.has(normalizeClassification(key));
}

export const TYPE_LABELS = Object.fromEntries(
  DOCUMENT_TYPES.map((t) => [t.key, t.label]),
);

export function labelForClassification(key) {
  const k = normalizeClassification(key);
  return TYPE_LABELS[k] || key || 'Document';
}

// Mapping classification → type de Document cofré.
// Critère majeur : famille SOCIÉTÉ → 'societe' (JAMAIS 'ag_copropriete').
export const COFFRE_TYPE_BY_CLASSIFICATION = Object.fromEntries(
  DOCUMENT_TYPES.map((t) => [t.key, t.coffre]),
);

export function coffreTypeForClassification(key) {
  return COFFRE_TYPE_BY_CLASSIFICATION[normalizeClassification(key)] || 'autre';
}

// --- Normalisation legacy → canonique ----------------------------------------
export const LEGACY_TO_CANONICAL = (() => {
  const m = {};
  for (const t of DOCUMENT_TYPES) {
    for (const alias of t.legacy_aliases || []) m[alias] = t.key;
  }
  return m;
})();

export const ALL_KNOWN_CLASSIFICATIONS = new Set([
  ...CLASSIFICATION_TYPES,
  ...Object.keys(LEGACY_TO_CANONICAL),
]);

export function normalizeClassification(key) {
  if (!key) return 'unknown';
  if (DOCUMENT_TYPE_BY_KEY[key]) return key;
  if (LEGACY_TO_CANONICAL[key]) return LEGACY_TO_CANONICAL[key];
  return 'autre';
}

export function isLegacyClassification(key) {
  return !!key && !!LEGACY_TO_CANONICAL[key];
}

export function getDocumentType(key) {
  return DOCUMENT_TYPE_BY_KEY[normalizeClassification(key)];
}

export function domainOf(key) {
  return getDocumentType(key)?.domain;
}

export function iconOf(key) {
  return getDocumentType(key)?.icon || 'FileQuestion';
}

export function processorOf(key) {
  return getDocumentType(key)?.processor || 'none';
}

export function isAutoProcessable(key) {
  return !!getDocumentType(key)?.accepted_for_auto_processing;
}

// --- Migration des documents historiquement mal classés -----------------------
export function classifyMigration(classification) {
  const raw = classification || 'unknown';
  const canonical = normalizeClassification(raw);
  if (LEGACY_TO_CANONICAL[raw]) {
    return { action: 'migrate', from: raw, to: canonical, reason: `clé legacy « ${raw} » → canonique « ${canonical} »` };
  }
  return { action: 'keep', to: canonical };
}

export function needsReviewCoffre(docType) {
  return docType === 'ag_copropriete';
}