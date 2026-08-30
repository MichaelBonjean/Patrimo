// Classificateur central de documents immobiliers.
//
// Heuristique deterministe par mots-cles (FR) sur le nom de fichier + le debut
// du texte OCR : zero credit LLM, testable, reproductible. Utilise par
// ingestDocument() AVANT toute classification LLM — si la confiance est
// suffisante (>= CONFIDENCE_THRESHOLD), on zappe l'appel LLM de classification.
//
// Synthese : { type, confidence, alternatives, explanation }
//   - type            : categorie documentaire (cf. CLASSIFICATION_TYPES)
//   - confidence      : 0-1, normalisee sur le score cumule des mots-cles
//   - alternatives    : top 3 autres types plausibles (confiance decroissante)
//   - explanation     : justification lisible (mots-cles detectes)
//
// Seuil de confiance eleve : en dessous, l'UI demande une confirmation non
// bloquante a l'utilisateur (Miroir cote front : src/lib/importerPipeline.js).

export const CONFIDENCE_THRESHOLD = 0.75;

export const CLASSIFICATION_TYPES = [
  'bail_alur', 'acte_vente_notarie', 'compromis', 'offre_pret_bancaire',
  'tableau_amortissement', 'releve_bancaire', 'releve_caf', 'taxe_fonciere',
  'diagnostic_technique', 'assurance_pno', 'appel_charges', 'facture',
  // Documents juridiques de société (sous-classification granulaire).
  // 'sci_statuts_kbis' conservé pour la rétro-compatibilité des enregistrements
  // existants ; le LegalEntityDocumentProcessor accepte aussi les nouveaux types.
  'statuts_societe', 'kbis_societe', 'cession_parts', 'pv_assemblee',
  'pv_societe', 'augmentation_capital', 'reduction_capital', 'beneficiaires_effectifs',
  'sci_statuts_kbis',
  'etat_des_lieux', 'quittance_loyer', 'autre', 'unknown',
];

// Famille juridique : toute classification appartenant aux documents de société.
export const LEGAL_ENTITY_TYPES = new Set([
  'statuts_societe', 'kbis_societe', 'cession_parts', 'pv_assemblee', 'pv_societe',
  'augmentation_capital', 'reduction_capital', 'beneficiaires_effectifs',
  'sci_statuts_kbis',
]);

export function isLegalEntity(type: string): boolean {
  return LEGAL_ENTITY_TYPES.has(type);
}

// Mots-cles pondérés par type. Poids ~ echelle de robustesse d'un signal.
const KEYWORDS: Record<string, Array<[string, number]>> = {
  bail_alur: [
    ['contrat de location', 3], ['bail de location', 3], ['bail alur', 3],
    ['soussigne', 1], ['locataire', 1], ['bailleur', 1], ['caution', 1],
    ['depot de garantie', 1], ['loyer mensuel', 1],
  ],
  acte_vente_notarie: [
    ['acte de vente', 4], ['acte authentique', 4], ['notaire', 2],
    ['acquereur', 2], ['vendeur', 2], ['prix de vente', 2], ['mutation', 1],
  ],
  compromis: [
    ['compromis de vente', 4], ['promesse de vente', 4], ['sous seing prive', 3],
    ['avant-contrat', 2], ['compromis', 2],
  ],
  offre_pret_bancaire: [
    ['offre de pret', 4], ['contrat de pret', 3], ['taeg', 3], ['taea', 2],
    ['assurance emprunteur', 2], ['emprunteur', 1], ['taux effectif', 2],
  ],
  tableau_amortissement: [
    ["tableau d'amortissement", 4], ['amortissement', 2], ['capital restant du', 3],
    ['echeancier', 2], ['mensualite', 1],
  ],
  releve_bancaire: [
    ['releve de compte', 4], ['releve bancaire', 4], ['compte n', 1],
    ['solde', 1], ['debit', 1],
  ],
  releve_caf: [
    ['caf', 3], ['allocation', 2], ['apl', 2], ['aide au logement', 3],
    ['prestation', 1],
  ],
  taxe_fonciere: [
    ['taxe fonciere', 4], ["avis d'imposition", 2], ['fonciere', 2],
  ],
  diagnostic_technique: [
    ['diagnostic de performance', 4], ['dpe', 3], ['classe energetique', 2],
    ['diagnostic technique', 2], ['ges', 1],
  ],
  assurance_pno: [
    ['assurance pno', 4], ['non occupant', 3], ['pno', 3],
    ['assurance proprietaire', 2], ['multirisque', 1],
  ],
  appel_charges: [
    ['appel de charges', 4], ['charges de copropriete', 3], ['copropriete', 1],
    ['provision sur charges', 2],
  ],
  facture: [
    ['facture', 3], ['tva', 1], ['reglement', 1],
  ],
  // Documents de société — sous-classification granulaire. Les mots-clés forts
  // spécifiques l'emportent sur le générique 'sci_statuts_kbis' (poids bas).
  statuts_societe: [
    ['statuts', 4], ['statuts constitutifs', 5], ['statuts modifies', 4],
    ['societe civile immobiliere', 4], ['forme juridique', 2],
    ['denomination sociale', 3], ['capital social', 2], ['objet social', 2],
    ['associe', 1], ['gerant', 1],
  ],
  kbis_societe: [
    ['kbis', 5], ['extrait kbis', 5], ["certificat d'immatriculation", 5],
    ['immatriculation', 3], ['greffe', 3], ['siren', 2], ['rcs', 2],
  ],
  cession_parts: [
    ['cession de parts', 5], ["acte de cession d'actions", 5],
    ['acte de cession', 4], ['cessionnaire', 3], ['cedant', 3],
    ['transfert de parts', 3], ['parts sociales', 2],
  ],
  pv_assemblee: [
    ["proces-verbal d'assemblee", 5], ['pv assemblee', 4], ['assemblee generale', 3],
    ['deliberation', 2], ['resolution', 2],
  ],
  augmentation_capital: [
    ['augmentation de capital', 5], ['augmentation du capital', 5],
    ['creation de parts', 3], ['nouvelles parts', 2],
  ],
  reduction_capital: [
    ['reduction de capital', 5], ['reduction du capital', 5],
    ['diminution du capital', 4], ['amortissement du capital', 3],
  ],
  pv_societe: [
    ['pv societe', 4], ['proces verbal de societe', 4], ['pv assemblee generale', 3],
  ],
  beneficiaires_effectifs: [
    ['beneficiaire effectif', 5], ['beneficiaires effectifs', 5],
    ['registre des beneficiaires', 4], ['rbe', 4], ['declarant les beneficiaires', 3],
  ],
  sci_statuts_kbis: [
    ['sci', 2], ['societe civile immobiliere', 3], ['statuts', 1],
  ],
  etat_des_lieux: [
    ['etat des lieux', 4], ["etat d'entree", 3], ['etat de sortie', 3],
    ['remise des cles', 2], ['inventaire', 1],
  ],
  quittance_loyer: [
    ['quittance', 4], ['recu de loyer', 3], ['quittance de loyer', 4],
    ['loyer du mois', 1],
  ],
};

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export interface ClassificationAlternative {
  type: string;
  confidence: number;
}

export interface ClassificationResult {
  type: string;
  confidence: number;
  alternatives: ClassificationAlternative[];
  explanation: string;
}

// Classifie un document immobilier a partir de son nom + debut de texte OCR.
// Renvoie toujours un resultat exploitable (unknown si rien ne matche).
export function classifyDocument(filename: string, text: string): ClassificationResult {
  const hay = normalize(`${filename || ''} ${String(text || '').slice(0, 4000)}`);
  const scores: Array<{ type: string; score: number; hits: string[] }> = [];
  for (const [type, kws] of Object.entries(KEYWORDS)) {
    let score = 0;
    const hits: string[] = [];
    for (const [kw, w] of kws) {
      if (hay.includes(normalize(kw))) { score += w; hits.push(kw); }
    }
    if (score > 0) scores.push({ type, score, hits });
  }
  if (scores.length === 0) {
    return {
      type: 'unknown',
      confidence: 0,
      alternatives: [],
      explanation: 'Aucun mot-cle discriminant detecte.',
    };
  }
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  // Normalisation : score 4 -> ~0.8 (au-dessus du seuil), score 5+ -> saturation.
  const confOf = (s: number) => Math.max(0.4, Math.min(0.97, s / 5));
  const confidence = confOf(top.score);
  const alternatives = scores.slice(1, 4).map((s) => ({
    type: s.type,
    confidence: confOf(s.score),
  }));
  const explanation = top.hits.length
    ? `Mots-cles detectes : ${top.hits.slice(0, 5).join(', ')}.`
    : 'Correspondance partielle.';
  return { type: top.type, confidence, alternatives, explanation };
}

export function isConfident(c: ClassificationResult): boolean {
  return c.confidence >= CONFIDENCE_THRESHOLD;
}