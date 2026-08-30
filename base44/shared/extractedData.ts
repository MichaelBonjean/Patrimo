/**
 * Donnée extraite canonique + matrice centralisée de sensibilité des champs.
 *
 * Patrimo ne doit jamais enregistrer aveuglément une donnée sensible incertaine :
 * l'OCR et l'IA peuvent produire des informations incorrectes, et toutes les
 * données extraites n'ont pas la même importance métier.
 *
 * Source unique de vérité : `FIELD_VALIDATION_RULES` (+ `LEVEL_RULES` pour les
 * valeurs par défaut de chaque niveau de risque). Aucun importeur documentaire
 * ne doit redéfinir ses propres seuils — tous passent par le `ConfidenceEngine`.
 *
 * Principes :
 *  1. Trois axes indépendants : confiance d'extraction (0-1), niveau de
 *     sensibilité du champ (low / medium / high), et statut courant (un retour
 *     utilisateur l'emporte toujours).
 *  2. On ne confond JAMAIS confiance d'extraction et importance métier : un
 *     champ HIGH_RISK peut exiger la confirmation humaine même à 99,9 %.
 *  3. `requireUserConfirmation === true` force la revue humaine, quel que soit
 *     le seuil (le seuil reste inscrit pour audit / diagnostique).
 *  4. La provenance (source_document_id / source_page / source_text) est
 *     conservée à chaque transition pour audit.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationStatus =
  | 'auto_validated'
  | 'needs_review'
  | 'user_validated'
  | 'user_corrected'
  | 'rejected';

export type ExtractionMethod =
  | 'ocr'
  | 'llm'
  | 'heuristic'
  | 'manual'
  | 'computed'
  | 'import';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ExtractedDatum {
  /** Identifiant métier du champ (ex : "purchase_price", "loan_rate", "rent_excluding_charges"). */
  field: string;
  /** Valeur brute extraite (telle qu'elle apparaît dans le document). */
  value: unknown;
  /** Valeur normalisée (parsing / comparaison) — optionnelle. */
  normalized_value?: unknown;
  /** Confiance d'EXTRACTION (OCR/IA), 0-1. Ne reflète PAS l'importance métier. */
  confidence: number;
  /** ID du document source (audit / provenance). */
  source_document_id?: string;
  /** Numéro de page du document source (1-based). */
  source_page?: number;
  /** Fragment de texte source d'où la valeur a été extraite (preuve). */
  source_text?: string;
  /** Statut de validation courant. */
  validation_status: ValidationStatus;
  /** Origine de l'extraction. */
  extraction_method: ExtractionMethod;
}

/**
 * Règle d'un champ. Toute clé omise hérite des valeurs par défaut du niveau
 * de risque (`LEVEL_RULES[risk]`).
 */
export interface FieldRule {
  risk: RiskLevel;
  /** Confiance minimum pour auto-validation (surcharge le défaut du niveau). */
  autoValidateThreshold?: number;
  /** Auto-validation autorisée pour ce champ (surcharge). */
  autoValidationAllowed?: boolean;
  /** Confirmation humaine obligatoire, quel que soit le seuil. */
  requireUserConfirmation?: boolean;
  /** Libellé métier (audit / diagnostique). */
  label?: string;
}

export interface LevelDefaults {
  /** Confiance minimum requise pour auto-valider un champ de ce niveau. */
  autoValidateThreshold: number;
  /** Auto-validation autorisée au niveau du niveau de risque. */
  autoValidationAllowed: boolean;
  /** Confirmation utilisateur obligatoire pour ce niveau. */
  requireUserConfirmation: boolean;
}

export interface ResolvedFieldRule {
  risk: RiskLevel;
  autoValidateThreshold: number;
  autoValidationAllowed: boolean;
  requireUserConfirmation: boolean;
  label: string | null;
}

export interface Decision {
  status: ValidationStatus;
  reason: string;
  riskLevel: RiskLevel;
  threshold: number;
  requireUserConfirmation: boolean;
}

// ---------------------------------------------------------------------------
// Niveaux de risque — valeurs par défaut
// ---------------------------------------------------------------------------

/**
 * Comportement par défaut de chaque niveau de sensibilité.
 *
 *  - LOW    : données informatives — auto-validation dès 0,75, pas de confirmation.
 *  - MEDIUM : données structurantes — auto-validation dès 0,90, pas de confirmation.
 *  - HIGH   : données sensibles financières / juridiques / d'identité —
 *             auto-validation INTERDITE par défaut, confirmation humaine obligatoire.
 *             (le seuil 0,995 est conservé comme « plancher de confiance »
 *             exploitable si un champ HIGH surcharge `requireUserConfirmation: false`.)
 */
export const LEVEL_RULES: Record<RiskLevel, LevelDefaults> = {
  low: {
    autoValidateThreshold: 0.75,
    autoValidationAllowed: true,
    requireUserConfirmation: false,
  },
  medium: {
    autoValidateThreshold: 0.9,
    autoValidationAllowed: true,
    requireUserConfirmation: false,
  },
  high: {
    autoValidateThreshold: 0.995,
    autoValidationAllowed: false,
    requireUserConfirmation: true,
  },
};

// ---------------------------------------------------------------------------
// Matrice centralisée — FIELD_VALIDATION_RULES
// ---------------------------------------------------------------------------

/**
 * Matrice de sensibilité par champ. IL N'Y A QU'UNE SEULE SOURCE : aucun
 * importeur ne doit redéfinir de seuil. Pour ajouter un champ, compléter ici.
 *
 * Un champ absent hérite du niveau `medium` (principe de précaution : exigence
 * 0,90, sans confirmation obligatoire mais pas d'auto-validation facile).
 */
export const FIELD_VALIDATION_RULES: Record<string, FieldRule> = {
  // --- LOW_RISK : informatif, faible impact --------------------------------
  bank_name: { risk: 'low', label: 'Nom de la banque' },
  notary_name: { risk: 'low', label: 'Nom du notaire' },
  city: { risk: 'low', label: 'Ville' },
  postal_code: { risk: 'low', label: 'Code postal' },
  supplier: { risk: 'low', label: 'Émetteur / fournisseur' },
  pages_count: { risk: 'low', label: 'Nombre de pages' },
  typology: { risk: 'low', label: 'Typologie' },
  dpe_class: { risk: 'low', label: 'Classe DPE' },
  ges_class: { risk: 'low', label: 'Classe GES' },
  furniture: { risk: 'low', label: 'Ameublement' },
  tenant_phone: { risk: 'low', label: 'Téléphone du locataire' },
  creation_date: { risk: 'low', label: 'Date de création (structure)' },
  siret: { risk: 'low', label: 'SIRET (public)' },

  // --- MEDIUM_RISK : structurant, corrigible ------------------------------
  surface: { risk: 'medium', label: 'Surface' },
  charges: { risk: 'medium', label: 'Charges' },
  tenant_email: { risk: 'medium', label: 'Email du locataire' },
  name: { risk: 'medium', label: 'Nom du bien' },
  address: { risk: 'medium', label: 'Adresse' },
  designation: { risk: 'medium', label: 'Désignation du lot' },
  notary: { risk: 'medium', label: 'Frais de notaire' },
  agency: { risk: 'medium', label: "Frais d'agence" },
  works: { risk: 'medium', label: 'Travaux' },
  due_day: { risk: 'medium', label: "Jour d'échéance" },
  lease_type: { risk: 'medium', label: 'Type de bail' },
  indexation_type: { risk: 'medium', label: 'Indice de référence' },
  index_value_current: { risk: 'medium', label: 'Indice courant' },
  document_date: { risk: 'medium', label: 'Date du document' },
  expiration_date: { risk: 'medium', label: "Date d'expiration" },
  amount: { risk: 'medium', label: 'Montant' },
  holder_type: { risk: 'medium', label: 'Type de détenteur' },
  // capital social reclassifié HIGH : donnée juridique sensible (statuts / Kbis).
  capital: { risk: 'high', label: 'Capital social' },

  // --- HIGH_RISK : sensible financier / juridique / identité --------------
  // Par défaut, confirmation humaine obligatoire. Le seuil 0,995 est le plancher
  // de confiance documenté (utilisable si un champ surcharge requireUserConfirmation).
  // Documents juridiques de société : identité, parts, détention, fiscalité,
  // représentant légal sont HIGH RISK (ne jamais enregistrer silencieusement).
  siren: { risk: 'high', label: 'SIREN (société)' },
  legal_form: { risk: 'high', label: 'Forme juridique' },
  representative_name: { risk: 'high', label: 'Représentant légal' },
  total_shares: { risk: 'high', label: 'Nombre de parts / actions' },
  par_value: { risk: 'high', label: 'Valeur nominale' },
  share_count: { risk: 'high', label: 'Parts détenues' },
  cession: { risk: 'high', label: "Cession d'actions / parts" },
  demembrement: { risk: 'high', label: 'Démembrement de propriété' },
  rcs_number: { risk: 'high', label: 'Numéro RCS' },
  purchase_price: { risk: 'high', label: "Prix d'acquisition" },
  loan_amount: {
    risk: 'high',
    label: 'Capital emprunté',
    autoValidateThreshold: 0.995,
    requireUserConfirmation: true,
  },
  monthly_payment: { risk: 'high', label: 'Mensualité' },
  loan_rate: { risk: 'high', label: "Taux d'emprunt" },
  duration_years: { risk: 'high', label: 'Durée du prêt' },
  loan_duration_years: { risk: 'high', label: 'Durée du prêt' },
  rent_excluding_charges: { risk: 'high', label: 'Loyer hors charges' },
  deposit: { risk: 'high', label: 'Dépôt de garantie' },
  date_start: { risk: 'high', label: "Date d'effet du bail" },
  date_end: { risk: 'high', label: 'Date de fin du bail' },
  share_percent: { risk: 'high', label: 'Quote-part (SCI / indivision)' },
  owner_name: { risk: 'high', label: 'Propriétaire' },
  holder_name: { risk: 'high', label: 'Détenteur' },
  tax_regime: { risk: 'high', label: 'Régime fiscal' },
  index_value_initial: { risk: 'high', label: 'Indice initial (base de révision)' },
  // --- Documents juridiques de société (extraction) -----------------------
  company_name: { risk: 'high', label: 'Dénomination sociale' },
  denomination: { risk: 'high', label: 'Dénomination sociale' },
  registered_office: { risk: 'medium', label: 'Siège social' },
  representative: { risk: 'high', label: 'Représentant légal' },
  registration_date: { risk: 'low', label: "Date d'immatriculation" },
  rcs: { risk: 'high', label: 'Numéro RCS' },
  shares_transferred: { risk: 'high', label: 'Parts cédées' },
  seller: { risk: 'high', label: 'Cédant' },
  buyer: { risk: 'high', label: 'Cessionnaire' },
  beneficial_owner: { risk: 'high', label: 'Bénéficiaire effectif' },
  associates: { risk: 'high', label: 'Associés / répartition du capital' },
  beneficial_owners: { risk: 'high', label: 'Bénéficiaires effectifs' },
  iban: { risk: 'high', label: 'IBAN' },
  ssn: { risk: 'high', label: 'Numéro de sécurité sociale' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Serre la confiance dans [0, 1]. Valeur absente/NaN → 0 (précaution). */
export function normalizeConfidence(c: number): number {
  if (typeof c !== 'number' || !Number.isFinite(c)) return 0;
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

/** Statuts déjà arbitrés par un humain (fin de cycle). */
export function isUserArbitrated(status: ValidationStatus): boolean {
  return status === 'user_validated' || status === 'user_corrected' || status === 'rejected';
}

/**
 * Résout la règle effective d'un champ en fusionnant les surcharges du champ
 * sur les valeurs par défaut de son niveau de risque. Champ inconnu → medium.
 */
export function resolveFieldRule(
  field: string,
  rules: Record<string, FieldRule> = FIELD_VALIDATION_RULES,
  levels: Record<RiskLevel, LevelDefaults> = LEVEL_RULES,
): ResolvedFieldRule {
  const f = rules[field];
  const risk: RiskLevel = f?.risk ?? 'medium';
  const base = levels[risk];
  return {
    risk,
    label: f?.label ?? null,
    autoValidateThreshold: f?.autoValidateThreshold ?? base.autoValidateThreshold,
    autoValidationAllowed: f?.autoValidationAllowed ?? base.autoValidationAllowed,
    requireUserConfirmation: f?.requireUserConfirmation ?? base.requireUserConfirmation,
  };
}

// ---------------------------------------------------------------------------
// ConfidenceEngine — API unique des importeurs documentaires
// ---------------------------------------------------------------------------

export class ConfidenceEngine {
  private rules: Record<string, FieldRule>;
  private levels: Record<RiskLevel, LevelDefaults>;

  constructor(
    rules: Record<string, FieldRule> = FIELD_VALIDATION_RULES,
    levels: Record<RiskLevel, LevelDefaults> = LEVEL_RULES,
  ) {
    this.rules = { ...rules };
    this.levels = { ...levels };
  }

  /** Niveau de risque d'un champ (inconnu → 'medium'). */
  riskOf(field: string): RiskLevel {
    return this.ruleFor(field).risk;
  }

  /** Libellé métier du champ (inconnu → null). */
  labelOf(field: string): string | null {
    return this.ruleFor(field).label;
  }

  /** Règle complète résolue pour un champ. */
  ruleFor(field: string): ResolvedFieldRule {
    return resolveFieldRule(field, this.rules, this.levels);
  }

  /** Seuil de confiance effectif pour ce champ. */
  thresholdFor(field: string): number {
    return this.ruleFor(field).autoValidateThreshold;
  }

  /** Enregistre / surcharge un champ (extension métier). */
  registerField(field: string, rule: FieldRule): this {
    this.rules[field] = { ...rule };
    return this;
  }

  /**
   * Décision de validation initiale d'une donnée (sans intervention humaine).
   * N'écrase JAMAIS un statut déjà arbitré.
   *
   *  1. requireUserConfirmation === true → needs_review (confirmation obligatoire,
   *     indépendamment de la confiance).
   *  2. confiance >= seuil effectif        → auto_validated.
   *  3. sinon                               → needs_review.
   */
  decide(field: string, confidence: number): Decision {
    const rule = this.ruleFor(field);
    const conf = normalizeConfidence(confidence);

    if (rule.requireUserConfirmation) {
      return {
        status: 'needs_review',
        reason: `Champ HIGH (« ${field} ») — confirmation utilisateur obligatoire, indépendante de la confiance (${(conf * 100).toFixed(0)}% < seuil plancher ${(rule.autoValidateThreshold * 100).toFixed(1)}%).`,
        riskLevel: rule.risk,
        threshold: rule.autoValidateThreshold,
        requireUserConfirmation: true,
      };
    }

    if (conf >= rule.autoValidateThreshold) {
      return {
        status: 'auto_validated',
        reason: `Confiance ${(conf * 100).toFixed(0)}% ≥ seuil ${rule.risk} (${(rule.autoValidateThreshold * 100).toFixed(0)}%).`,
        riskLevel: rule.risk,
        threshold: rule.autoValidateThreshold,
        requireUserConfirmation: false,
      };
    }

    return {
      status: 'needs_review',
      reason: `Confiance ${(conf * 100).toFixed(0)}% < seuil ${rule.risk} (${(rule.autoValidateThreshold * 100).toFixed(0)}%).`,
      riskLevel: rule.risk,
      threshold: rule.autoValidateThreshold,
      requireUserConfirmation: false,
    };
  }

  /**
   * Évalue une donnée extraite → nouvelle donnée avec statut calculé.
   * Préserve la provenance, ne mute pas l'entrée.
   * Un statut déjà arbitré par l'humain est conservé tel quel.
   */
  evaluate(datum: ExtractedDatum): ExtractedDatum & { _decision?: Decision } {
    if (isUserArbitrated(datum.validation_status)) {
      return { ...datum };
    }
    const decision = this.decide(datum.field, datum.confidence);
    return { ...datum, validation_status: decision.status, _decision: decision };
  }

  /** Évalue un lot (nouveau tableau, préserve ordre + provenance). */
  evaluateBatch(data: ExtractedDatum[]): ExtractedDatum[] {
    return data.map((d) => {
      const r = this.evaluate(d);
      const { _decision, ...clean } = r;
      return clean;
    });
  }

  /** Transition de cycle de vie déclenchée par un humain. */
  markValidated(
    datum: ExtractedDatum,
    status: 'user_validated' | 'user_corrected' | 'rejected',
    correctedValue?: unknown,
  ): ExtractedDatum {
    const next: ExtractedDatum = { ...datum, validation_status: status };
    if (status === 'user_corrected' && correctedValue !== undefined) {
      next.value = correctedValue;
    }
    return next;
  }

  /** Donnée prête à être commitée (auto ou humain validée). */
  isCommittable(datum: ExtractedDatum): boolean {
    return (
      datum.validation_status === 'auto_validated' ||
      datum.validation_status === 'user_validated' ||
      datum.validation_status === 'user_corrected'
    );
  }

  /** Donnée restant à valider par un humain. */
  requiresReview(datum: ExtractedDatum): boolean {
    return datum.validation_status === 'needs_review';
  }
}

// ---------------------------------------------------------------------------
// Fabriques
// ---------------------------------------------------------------------------

/** Construit un `ExtractedDatum` complet avec valeurs par défaut sûres. */
export function buildExtractedDatum(
  field: string,
  value: unknown,
  opts: {
    confidence?: number;
    normalized_value?: unknown;
    source_document_id?: string;
    source_page?: number;
    source_text?: string;
    validation_status?: ValidationStatus;
    extraction_method?: ExtractionMethod;
  } = {},
): ExtractedDatum {
  return {
    field,
    value,
    normalized_value: opts.normalized_value,
    confidence: normalizeConfidence(opts.confidence ?? 0),
    source_document_id: opts.source_document_id,
    source_page: opts.source_page,
    source_text: opts.source_text,
    validation_status: opts.validation_status ?? 'needs_review',
    extraction_method: opts.extraction_method ?? 'ocr',
  };
}

/** Instance partagée — API unique que tous les importeurs doivent utiliser. */
export const confidenceEngine = new ConfidenceEngine();