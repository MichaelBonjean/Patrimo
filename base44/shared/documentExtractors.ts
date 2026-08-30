// Extracteurs spécialisés pour l'ingestion IA des documents immobiliers.
//
//  - Classification en 8 types (+ autre / unknown)
//  - Schéma d'extraction structuré par type
//  - Masquage RGPD : IBAN, CB, nº sécurité sociale — jamais en clair.
//
// Le prompt LLM contient explicitement l'instruction de NE PAS retourner
// d'informations sensibles (santé, origines, opinions politiques/religieuses).

export const CLASSIFICATION_TYPES = [
  'bail_alur', 'acte_vente_notarie', 'compromis', 'offre_pret_bancaire',
  'tableau_amortissement', 'releve_bancaire', 'releve_caf', 'taxe_fonciere',
  'diagnostic_technique', 'assurance_pno', 'appel_charges', 'facture',
  'statuts_societe', 'kbis_societe', 'cession_parts', 'pv_assemblee', 'pv_societe',
  'augmentation_capital', 'reduction_capital', 'beneficiaires_effectifs',
  'sci_statuts_kbis', 'etat_des_lieux', 'quittance_loyer', 'autre', 'unknown',
];

export const TYPE_LABELS = {
  bail_alur: 'Bail ALUR',
  acte_vente_notarie: 'Acte de vente notarié',
  compromis: 'Compromis de vente',
  offre_pret_bancaire: 'Offre de prêt bancaire',
  tableau_amortissement: "Tableau d'amortissement",
  releve_bancaire: 'Relevé bancaire',
  releve_caf: 'Relevé CAF / APL',
  taxe_fonciere: "Avis de taxe foncière",
  diagnostic_technique: 'Diagnostic technique (DPE)',
  assurance_pno: 'Assurance PNO',
  appel_charges: "Appel de charges de copropriété",
  facture: 'Facture',
  sci_statuts_kbis: 'Statuts / Kbis SCI',
  pv_societe: 'PV assemblée société',
  reduction_capital: 'Réduction de capital',
  beneficiaires_effectifs: 'Bénéficiaires effectifs',
  etat_des_lieux: 'État des lieux',
  quittance_loyer: 'Quittance de loyer',
  autre: 'Autre document',
  unknown: 'Non classé',
};

export function labelFor(type) {
  return TYPE_LABELS[type] || type || 'Document';
}

// ---------------------------------------------------------------------------
// Documents juridiques de société — schéma d'extraction partagé
// ---------------------------------------------------------------------------

export const LEGAL_ENTITY_EXTRACTION_TYPES = [
  'statuts_societe', 'kbis_societe', 'sci_statuts_kbis', 'cession_parts',
  'pv_assemblee', 'pv_societe', 'augmentation_capital', 'reduction_capital',
  'beneficiaires_effectifs',
];

/** Schéma JSON d'un associé (personne physique ou morale). */
export function associateSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['individual', 'company'] },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        company_name: { type: 'string' },
        siren: { type: 'string' },
        share_count: { type: 'number' },
        share_percent: { type: 'number' },
        role: { type: 'string' },
        ownership_type: { type: 'string' },
        effective_from: { type: 'string' },
        demembrement: { type: 'string' },
      },
    },
  };
}

/** Champs d'une société extraits des statuts / PV (hors champs spécifiques au type). */
export function legalStatutsFields() {
  return {
    company_name: { type: 'string' },
    legal_form: { type: 'string' },
    siren: { type: 'string' },
    siret: { type: 'string' },
    registered_office: { type: 'string' },
    capital: { type: 'number' },
    capital_type: { type: 'string' },
    creation_date: { type: 'string' },
    representative_name: { type: 'string' },
    total_shares: { type: 'number' },
    par_value: { type: 'number' },
    tax_regime: { type: 'string' },
    objet_social: { type: 'string' },
    duration_end: { type: 'string' },
    date: { type: 'string' },
    associates: associateSchema(),
  };
}

/**
 * Instruction d'extraction spécialisée par type juridique. Cf. cahier des
 * charges : on n'invente JAMAIS share_percent ni le régime fiscal (IR/IS).
 */
export function legalExtractionInstruction(type) {
  const common =
    " Tu extrais les informations structurelles d'un document JURIDIQUE de société. " +
    "RÈGLES ABSOLUES : (1) Ne JAMAIS inventer une donnée absente — laisse le champ null/absent. " +
    "(2) Ne JAMAIS déduire le régime fiscal (IR/IS/SCI à l'IR) de la forme juridique : ne remplis " +
    "tax_regime QUE s'il figure explicitement dans le document. " +
    "(3) associates[] = un objet par associé. Personne physique : name = prénom + nom, type='individual', " +
    "remplis first_name/last_name. Personne morale : name = dénomination, type='company', remplis " +
    "company_name + siren. (4) share_percent ne s'invente JAMAIS : si total_shares ET share_count sont " +
    "connus, calcule share_percent = round(share_count / total_shares * 100, 1) ; sinon laisse null. " +
    "(5) ownership_type = pleine_propriete / usufruit / nue_propriete si mentionné. " +
    "(6) effective_from = date d'entrée/deffet si visible.";
  let specifics = '';
  if (type === 'statuts_societe' || type === 'sci_statuts_kbis') {
    specifics =
      " STATUTS : extrais company_name, legal_form, siren, siret, registered_office, capital, " +
      "capital_type (fixe/variable), creation_date, representative_name (gérant/président), " +
      "total_shares, par_value, tax_regime (si explicite), objet_social, duration_end, et associates[] " +
      "réunissant TOUS les associés avec leur nombre de parts et la quote-part.";
  } else if (type === 'kbis_societe') {
    specifics =
      " KBIS (extrait Kbis / certificat d'immatriculation) : extrais company_name, legal_form, siren, " +
      "siret, registered_office, capital, registration_date, rcs_number, representative_name. " +
      "Un Kbis ne liste PAS la répartition des associés — ne l'invente surtout pas.";
  } else if (type === 'cession_parts') {
    specifics =
      " CESSION DE PARTS : extrais company_name + siren de la société concernée, seller (cédant), " +
      "buyer (cessionnaire), shares_transferred, total_shares, share_percent (si déterminable : " +
      "shares_transferred / total_shares), effective_date de la cession. Ne retourne PAS associates[] " +
      "(la cession est une PROPOSITION de modification, à appliquer par validation).";
  } else if (type === 'pv_assemblee' || type === 'pv_societe') {
    specifics =
      " PROCÈS-VERBAL D'ASSEMBLÉE : extrais company_name, siren, date, resolutions[] (liste des " +
      "résolutions adoptées), capital_change {old_capital, new_capital} si voté, et associates[] " +
      "reflétant l'état RÉSULTANT des décisions (post-résolution).";
  } else if (type === 'augmentation_capital') {
    specifics =
      " AUGMENTATION DE CAPITAL : extrais company_name, siren, old_capital, new_capital, total_shares " +
      "(nombre de parts après augmentation), et associates[] avec la nouvelle répartition.";
  } else if (type === 'reduction_capital') {
    specifics =
      " RÉDUCTION DE CAPITAL : extrais company_name, siren, old_capital, new_capital, total_shares " +
      "(après réduction), et associates[] avec la nouvelle répartition.";
  } else if (type === 'beneficiaires_effectifs') {
    specifics =
      " DÉCLARATION DE BÉNÉFICIAIRES EFFECTIFS (RBE) : extrais company_name, siren, et ben[c]ficial_owners[] " +
      "{name, type ('individual'/'company'), siren, share_percent, control_nature}. Un bénéficiaire " +
      "effectif n'est pas forcément un associé — ne les confonds pas.";
  }
  return common + specifics;
}

const SAFETY_INSTRUCTION =
  "Ignore et ne retourne PAS d'informations relatives à la santé, aux origines, " +
  "aux opinions politiques ou religieuses même si elles apparaissent dans le document.";

export function classifyPrompt(text) {
  return (
    "Voici le début d'un document français : " +
    String(text || '').slice(0, 2000) +
    '. Classe-le dans l\'une des catégories : bail_alur, acte_vente_notarie, compromis, ' +
    'offre_pret_bancaire, tableau_amortissement, releve_bancaire, releve_caf, taxe_fonciere, ' +
    'diagnostic_technique, assurance_pno, appel_charges, facture, statuts_societe, kbis_societe, ' +
    'cession_parts, pv_assemblee, pv_societe, augmentation_capital, reduction_capital, ' +
    'beneficiaires_effectifs, sci_statuts_kbis, etat_des_lieux, quittance_loyer, autre. ' +
    'Réponds uniquement avec un JSON ' +
    '{type, confidence (0-1), reason, alternatives (tableau des 3 autres types plausibles ' +
    'triés par confiance décroissante)}. ' +
    SAFETY_INSTRUCTION
  );
}

export function extractionPrompt(type, text) {
  let extra = '';
  if (type === 'bail_alur') {
    extra =
      " Pour un bail d'habitation, remplis tenants[] (une entrée par locataire ; couple ou " +
      "colocation = plusieurs entrées — sinon fournis tenant_name seul), landlord_name, address, " +
      "lot_designation/lot_code/lot_surface/floor, date_start, date_end (si bail à durée déterminée), " +
      "rent_excluding_charges, charges, deposit, due_day, lease_type (Vide-Nu/Meublé/Bail mobilité/Bail " +
      "étudiant/Saisonnier-Airbnb…), furnished, indexation_type (IRL/ILC/ILAT/aucune), index_reference " +
      "(trimestre/année, ex. T1 2024), index_value_initial et revision_clause (clause de révision). " +
      "N'invente AUCUNE donnée absente du document.";
  }
  if (type === 'acte_vente_notarie') {
    extra =
      " Pour un acte de vente notarié, remplis buyers[] (acquéreurs + share_percent), " +
      "copro_lots[] (logement, cave, garage, parking, box), cadastral_references[], " +
      "address/postal_code/city, acquisition_date, purchase_price, notary_fees, surfaces. " +
      "N'invente AUCUNE donnée absente du document : ne déduis NI le régime fiscal locatif " +
      "futur, NI le LMNP, NI le régime SCI à l'IS/IR (sauf si explicitement établi dans " +
      "l'acte). holding_structure et tax_regime doivent rester vides sauf s'ils figurent " +
      "explicitement dans l'acte.";
  }
  if (LEGAL_ENTITY_EXTRACTION_TYPES.includes(type)) {
    extra = legalExtractionInstruction(type);
  }
  return (
    "Document classé « " + labelFor(type) + " ». Extrait les données structurées. " +
    "Réponds uniquement avec un JSON {extracted_data: {...}, confidence_per_field: {...}}. " +
    "Contexte OCR : " + String(text || '').slice(0, 4000) + ". " +
    SAFETY_INSTRUCTION + extra
  );
}

// Schéma JSON passé à InvokeLLM pour forcer une réponse structurée par type.
export function extractorSchema(type) {
  return {
    type: 'object',
    properties: {
      extracted_data: {
        type: 'object',
        additionalProperties: true,
        properties: extractorFields(type),
      },
      confidence_per_field: { type: 'object', additionalProperties: true },
    },
  };
}

function extractorFields(type) {
  switch (type) {
    case 'bail_alur':
      return {
        tenant_name: { type: 'string' },
        tenants: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, entry_date: { type: 'string' } },
          },
        },
        landlord_name: { type: 'string' },
        address: { type: 'string' }, lot_designation: { type: 'string' }, lot_code: { type: 'string' },
        lot_surface: { type: 'number' }, floor: { type: 'string' },
        date_start: { type: 'string' }, date_end: { type: 'string' },
        rent_excluding_charges: { type: 'number' }, charges: { type: 'number' },
        deposit: { type: 'number' }, due_day: { type: 'number' },
        lease_type: { type: 'string' }, furnished: { type: 'boolean' },
        indexation_type: { type: 'string' }, index_reference: { type: 'string' },
        index_value_initial: { type: 'number' }, revision_clause: { type: 'string' },
      };
    case 'acte_vente_notarie':
      return {
        notary: { type: 'string' },
        notary_office: { type: 'string' },
        seller: { type: 'string' },
        buyer: { type: 'string' },
        buyers: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, share_percent: { type: 'number' } },
          },
        },
        shares: { type: 'string' },
        address: { type: 'string' },
        address_street: { type: 'string' },
        postal_code: { type: 'string' },
        city: { type: 'string' },
        acquisition_date: { type: 'string' },
        date: { type: 'string' },
        purchase_price: { type: 'number' },
        notary_fees: { type: 'number' },
        agency_fees: { type: 'number' },
        total_surface: { type: 'number' },
        surface: { type: 'number' },
        cadastral_references: { type: 'array', items: { type: 'string' } },
        copro_lots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              designation: { type: 'string' },
              type: { type: 'string' },
              code: { type: 'string' },
              lot_number: { type: 'string' },
              surface: { type: 'number' },
            },
          },
        },
        holding_structure: { type: 'string' },
        tax_regime: { type: 'string' },
      };
    case 'offre_pret_bancaire':
      return {
        bank: { type: 'string' }, borrower: { type: 'string' },
        loan_amount: { type: 'number' }, rate: { type: 'number' },
        duration_years: { type: 'number' }, monthly_payment: { type: 'number' },
        insurance: { type: 'number' }, date: { type: 'string' },
      };
    case 'tableau_amortissement':
      return {
        bank: { type: 'string' }, loan_amount: { type: 'number' }, rate: { type: 'number' },
        monthly_payment: { type: 'number' }, duration_years: { type: 'number' },
      };
    case 'releve_bancaire':
      return {
        bank: { type: 'string' }, account: { type: 'string' },
        period: { type: 'string' }, balance: { type: 'number' },
      };
    case 'diagnostic_technique':
      return {
        type_dpe: { type: 'string' }, address: { type: 'string' }, date: { type: 'string' },
        energy_class: { type: 'string' }, expiration_date: { type: 'string' },
      };
    case 'statuts_societe':
    case 'sci_statuts_kbis':
      return legalStatutsFields();
    case 'kbis_societe':
      return {
        company_name: { type: 'string' }, legal_form: { type: 'string' },
        siren: { type: 'string' }, siret: { type: 'string' },
        registered_office: { type: 'string' }, capital: { type: 'number' },
        registration_date: { type: 'string' }, rcs_number: { type: 'string' },
        representative_name: { type: 'string' }, date: { type: 'string' },
      };
    case 'cession_parts':
      return {
        company_name: { type: 'string' }, siren: { type: 'string' },
        seller: { type: 'string' }, buyer: { type: 'string' },
        shares_transferred: { type: 'number' }, total_shares: { type: 'number' },
        share_percent: { type: 'number' }, effective_date: { type: 'string' },
      };
    case 'pv_assemblee':
    case 'pv_societe':
      return {
        ...legalStatutsFields(),
        resolutions: { type: 'array', items: { type: 'string' } },
        capital_change: {
          type: 'object',
          properties: { old_capital: { type: 'number' }, new_capital: { type: 'number' } },
        },
      };
    case 'augmentation_capital':
    case 'reduction_capital':
      return { ...legalStatutsFields(), old_capital: { type: 'number' }, new_capital: { type: 'number' } };
    case 'beneficiaires_effectifs':
      return {
        company_name: { type: 'string' }, siren: { type: 'string' },
        beneficial_owners: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' }, type: { type: 'string' }, siren: { type: 'string' },
              share_percent: { type: 'number' }, control_nature: { type: 'string' },
            },
          },
        },
      };
    case 'quittance_loyer':
      return {
        tenant_name: { type: 'string' }, landlord_name: { type: 'string' },
        period: { type: 'string' }, rent: { type: 'number' }, charges: { type: 'number' },
        total: { type: 'number' }, payment_date: { type: 'string' },
      };
    case 'compromis':
      return {
        seller: { type: 'string' }, buyer: { type: 'string' },
        address: { type: 'string' }, price: { type: 'number' },
        notary: { type: 'string' }, date: { type: 'string' },
      };
    case 'releve_caf':
      return {
        beneficiary: { type: 'string' }, address: { type: 'string' },
        period: { type: 'string' }, amount: { type: 'number' },
        allocation_type: { type: 'string' }, date: { type: 'string' },
      };
    case 'taxe_fonciere':
      return {
        owner: { type: 'string' }, address: { type: 'string' },
        year: { type: 'number' }, amount: { type: 'number' },
        date: { type: 'string' },
      };
    case 'assurance_pno':
      return {
        insurer: { type: 'string' }, insured: { type: 'string' },
        address: { type: 'string' }, premium: { type: 'number' },
        date_start: { type: 'string' }, date_end: { type: 'string' },
      };
    case 'appel_charges':
      return {
        syndic: { type: 'string' }, address: { type: 'string' },
        period: { type: 'string' }, amount: { type: 'number' },
        date: { type: 'string' },
      };
    case 'facture':
      return {
        supplier: { type: 'string' }, address: { type: 'string' },
        amount: { type: 'number' }, date: { type: 'string' },
        invoice_number: { type: 'string' }, due_date: { type: 'string' },
      };
    case 'etat_des_lieux':
      return {
        tenant_name: { type: 'string' }, landlord_name: { type: 'string' },
        address: { type: 'string' }, date: { type: 'string' },
        type_edl: { type: 'string' },
      };
    default:
      return {
        title: { type: 'string' }, date: { type: 'string' },
        amount: { type: 'number' }, supplier: { type: 'string' },
      };
  }
}

// --- Masquage RGPD des données sensibles ---------------------------------

export function maskSensitive(text) {
  if (!text || typeof text !== 'string') return text || '';
  let t = text;
  // IBAN (FR + 12 à 30 chiffres, espaces possibles)
  t = t.replace(/[A-Z]{2}\d{2}(?:\s?\d{4}){4,8}/g, (m) => m.slice(0, 4) + ' **** **** ' + m.slice(-4));
  // Carte bancaire (13 à 16 chiffres, séparateurs espace/tiret)
  t = t.replace(/(?:\d[ -]?){13,16}(?=\D|$)/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return '**** **** **** ' + digits.slice(-4);
  });
  // Nº sécurité sociale (13 chiffres en groupes 1 12 2 12 2 12 2 3)
  t = t.replace(/\b(\d{1,2})\s?(\d{2})\s?(\d{2})\s?(\d{2})\s?(\d{3})\s?(\d{2,3})/g, '$1 ** ** ** *** **');
  return t;
}

export function maskObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  try {
    return JSON.parse(maskSensitive(JSON.stringify(obj)));
  } catch {
    return obj;
  }
}

export function clampConf(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}