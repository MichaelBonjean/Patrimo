// Architecture d'extraction par chunks/pages pour les documents longs
// (actes notariés, offres de prêt, statuts, tableaux d'amortissement).
//
// Pipeline :
//   Document OCR → pages → classification → recherche ciblée (mots-clés)
//   → extraction par section/page → merge → résolution des conflits.
//
// Garanties :
//  - chaque extraction conserve : page, confidence, source_text (provenance) ;
//  - une information page 27 peut être trouvée et utilisée avec sa provenance ;
//  - deux pages contradictoires → PROPOSITION DE CONFLIT (pas de choix arbitraire) ;
//  - performance : on n'envoie jamais 100 pages entières au modèle — on extrait
//    des chunks ciblés (une page ou moins autour du mot-clé) par section.
//
// PUR (aucun import plateforme) → testable unitairement. Le runner (ingestDocument)
// exécute les tâches via InvokeLLM puis passe les résultats à `mergeExtractionResults`.

import { normalizeClassification } from './documentTypes.ts';

// Seuil : en dessous, extraction single-pass (coût minimal). Au-dessus, pipeline
// par chunks ciblés. Les 4 types longs prioritaires sont sectionnés.
export const CHUNK_THRESHOLD = 10;
export const MAX_PAGES_PER_SECTION = 3;
export const MAX_CHUNK_CHARS = 3500;

/** Découpe un texte brut en pages (par form-feed ; sinon découpage en N parts). */
export function splitTextIntoPages(text: string, count: number): string[] {
  if (!text) return [];
  if (text.includes('\f')) {
    return text.split('\f').map((p) => p || '');
  }
  const n = Math.max(1, Math.min(count || 1, 200));
  if (n === 1) return [text];
  const approx = Math.ceil(text.length / n);
  const pages: string[] = [];
  for (let i = 0; i < text.length; i += approx) {
    pages.push(text.slice(i, i + approx));
  }
  return pages;
}

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// --- Cibles de recherche par classification -----------------------------------
// Une « section » = un groupe de champs à extraire + les mots-clés qui la
// localisent dans le document. Le runner extrait ces champs depuis la(les)
// page(s) où les mots-clés apparaissent.
export interface SectionTarget {
  section: string;
  fields: string[];
  keywords: string[];
  schema: Record<string, any>;
}

const T = (section: string, fields: string[], keywords: string[], schema: Record<string, any>): SectionTarget =>
  ({ section, fields, keywords, schema });

export const SECTION_TARGETS: Record<string, SectionTarget[]> = {
  acte_vente: [
    T('acquereurs', ['buyers', 'buyer', 'shares'], ['acquereur', 'soussigne', 'vendu a', 'acquis par'],
      { buyers: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, share_percent: { type: 'number' } } } }, buyer: { type: 'string' }, shares: { type: 'string' } }),
    T('prix', ['purchase_price', 'notary_fees', 'agency_fees'], ['prix de vente', 'prix', 'montant', 'somme de'],
      { purchase_price: { type: 'number' }, notary_fees: { type: 'number' }, agency_fees: { type: 'number' } }),
    T('adresse', ['address', 'address_street', 'postal_code', 'city', 'cadastral_references'], ['adresse', 'situe', 'lot de copropriete', 'cadastre'],
      { address: { type: 'string' }, address_street: { type: 'string' }, postal_code: { type: 'string' }, city: { type: 'string' }, cadastral_references: { type: 'array', items: { type: 'string' } } }),
    T('lots', ['copro_lots'], ['lot de copropriete', 'cave', 'garage', 'parking', 'box', 'lot numero', 'annexe'],
      { copro_lots: { type: 'array', items: { type: 'object', properties: { designation: { type: 'string' }, type: { type: 'string' }, code: { type: 'string' }, lot_number: { type: 'string' }, surface: { type: 'number' } } } } }),
    T('quotes_parts', ['holding_structure', 'tax_regime'], ['quote-part', 'pourcentage', 'indivision', 'pleine propriete', 'usufruit'],
      { holding_structure: { type: 'string' }, tax_regime: { type: 'string' } }),
    T('date_acquisition', ['acquisition_date', 'date', 'notary'], ['acte authentique', 'passe devant', 'notaire', 'date'],
      { acquisition_date: { type: 'string' }, date: { type: 'string' }, notary: { type: 'string' } }),
  ],
  statuts_societe: [
    T('denomination', ['company_name', 'legal_form'], ['denomination sociale', 'denomination', 'forme juridique', 'societe civile'],
      { company_name: { type: 'string' }, legal_form: { type: 'string' } }),
    T('siege', ['registered_office', 'address'], ['siege social', 'adresse du siege', 'domiciliation'],
      { registered_office: { type: 'string' }, address: { type: 'string' } }),
    T('capital', ['capital', 'capital_type', 'total_shares', 'par_value'], ['capital social', 'capital fixe', 'capital variable', 'valeur nominale', 'parts'],
      { capital: { type: 'number' }, capital_type: { type: 'string' }, total_shares: { type: 'number' }, par_value: { type: 'number' } }),
    T('associes', ['associates'], ['associe', 'associes', 'parts sociales', 'repartition'],
      { associates: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, share_count: { type: 'number' }, share_percent: { type: 'number' } } } } }),
    T('gerance', ['representative_name', 'duration_end'], ['gerant', 'gerance', 'representant legal', 'president', 'duree'],
      { representative_name: { type: 'string' }, duration_end: { type: 'string' } }),
  ],
  kbis_societe: [
    T('immatriculation', ['company_name', 'legal_form', 'siren', 'siret', 'registration_date', 'rcs_number', 'representative_name', 'capital', 'registered_office'],
      ['immatriculation', 'greffe', 'rcs', 'siren', 'capital', 'siege', 'gerant'],
      { company_name: { type: 'string' }, legal_form: { type: 'string' }, siren: { type: 'string' }, siret: { type: 'string' }, registration_date: { type: 'string' }, rcs_number: { type: 'string' }, representative_name: { type: 'string' }, capital: { type: 'number' }, registered_office: { type: 'string' } }),
  ],
  cession_parts: [
    T('cession', ['company_name', 'siren', 'seller', 'buyer', 'shares_transferred', 'total_shares', 'share_percent', 'effective_date'],
      ['cession', 'cedant', 'cessionnaire', 'parts sociales', 'transfert'],
      { company_name: { type: 'string' }, siren: { type: 'string' }, seller: { type: 'string' }, buyer: { type: 'string' }, shares_transferred: { type: 'number' }, total_shares: { type: 'number' }, share_percent: { type: 'number' }, effective_date: { type: 'string' } }),
  ],
  offre_pret: [
    T('capital', ['loan_amount', 'borrower', 'bank'], ['capital emprunte', 'montant du pret', 'capital', 'emprunteur'],
      { loan_amount: { type: 'number' }, borrower: { type: 'string' }, bank: { type: 'string' } }),
    T('taux', ['rate'], ['taux', 'taeg', 'taea', 'taux nominal'],
      { rate: { type: 'number' } }),
    T('duree', ['duration_years', 'loan_start_date'], ['duree', 'amortissement', 'annees', 'mois', 'premiere echeance'],
      { duration_years: { type: 'number' }, loan_start_date: { type: 'string' } }),
    T('mensualite', ['monthly_payment', 'date'], ['mensualite', 'echeance', 'montant', 'reglement'],
      { monthly_payment: { type: 'number' }, date: { type: 'string' } }),
    T('assurance', ['monthly_insurance', 'insurance'], ['assurance', 'deces', 'invalidite', 'garanties'],
      { monthly_insurance: { type: 'number' }, insurance: { type: 'number' } }),
    T('differe', ['deferred_months'], ['differe', 'franchise', 'anticipation'],
      { deferred_months: { type: 'number' } }),
  ],
  tableau_amortissement: [
    T('echeancier', ['installments_count', 'total_interest', 'total_paid'], ['echeance', 'capital restant du', 'interet', 'amortissement'],
      { installments_count: { type: 'number' }, total_interest: { type: 'number' }, total_paid: { type: 'number' } }),
    T('mensualite', ['monthly_payment', 'rate', 'duration_years', 'loan_amount'], ['mensualite', 'taux', 'duree', 'capital'],
      { monthly_payment: { type: 'number' }, rate: { type: 'number' }, duration_years: { type: 'number' }, loan_amount: { type: 'number' } }),
  ],
  pv_societe: [
    T('pv', ['company_name', 'siren', 'date', 'resolutions', 'capital_change', 'associates'],
      ['assemblee generale', 'proces verbal', 'resolution', 'deliberation'],
      {
        company_name: { type: 'string' }, siren: { type: 'string' }, date: { type: 'string' },
        resolutions: { type: 'array', items: { type: 'string' } },
        capital_change: { type: 'object', properties: { old_capital: { type: 'number' }, new_capital: { type: 'number' } } },
        associates: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, share_percent: { type: 'number' } } } },
      }),
  ],
};

export function hasSectionTargets(classification: string): boolean {
  const k = normalizeClassification(classification);
  return !!SECTION_TARGETS[k] && SECTION_TARGETS[k].length > 0;
}

export function getSectionTargets(classification: string): SectionTarget[] {
  return SECTION_TARGETS[normalizeClassification(classification)] || [];
}

// --- Recherche ciblée ---------------------------------------------------------
export function locateCandidatePages(
  pages: string[],
  keywords: string[],
  maxPages = MAX_PAGES_PER_SECTION,
): { page: number; score: number; text: string }[] {
  const nks = keywords.map(norm).filter(Boolean);
  if (!nks.length || !pages.length) return [];
  const scored: { page: number; score: number; text: string }[] = [];
  pages.forEach((raw, idx) => {
    const hay = norm(raw);
    if (!hay) return;
    let score = 0;
    for (const k of nks) if (hay.includes(k)) score++;
    if (score > 0) scored.push({ page: idx + 1, score, text: raw });
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxPages);
}

function capChunk(text: string): string {
  if (!text) return '';
  return text.length > MAX_CHUNK_CHARS ? text.slice(0, MAX_CHUNK_CHARS) : text;
}

export interface ExtractionTask {
  section: string;
  page: number;
  source_text: string;
  matched_keywords: string[];
  fields: string[];
  prompt: string;
  json_schema: any;
}

export function buildExtractionTasks(opts: { classification: string; pages: string[] }): ExtractionTask[] {
  const { classification, pages } = opts;
  const targets = getSectionTargets(classification);
  const tasks: ExtractionTask[] = [];
  for (const t of targets) {
    const cands = locateCandidatePages(pages, t.keywords);
    const pagesToUse = cands.length ? cands : [{ page: 1, score: 0, text: pages[0] || '' }];
    for (const c of pagesToUse) {
      const chunk = capChunk(c.text);
      const hitKw = t.keywords.filter((k) => norm(chunk).includes(norm(k)));
      const fl = t.fields.join(', ');
      tasks.push({
        section: t.section,
        page: c.page,
        source_text: chunk,
        matched_keywords: hitKw,
        fields: t.fields,
        prompt:
          `Extrait les champs suivants de CETTE page de document (${t.section}). ` +
          `Champs : ${fl}. Réponds uniquement en JSON { ${t.fields.join(', ')}, _confidence: { <champ>: 0-1 } }. ` +
          `Ne complémente QUE les champs présents sur cette page ; laisse absents les champs non visibles. ` +
          `N'invente JAMAIS. Ignore les données sensibles (santé, origines, opinions). ` +
          `Contexte de la page ${c.page} : ${chunk}`,
        json_schema: {
          type: 'object',
          properties: { ...t.schema, _confidence: { type: 'object', additionalProperties: true } },
        },
      });
    }
  }
  return tasks;
}

// --- Merge + résolution de conflits ------------------------------------------

export interface FieldCandidate {
  value: any;
  confidence: number;
  page: number;
  source_text: string;
}

export interface ConflictProposal {
  field: string;
  status: 'unresolved';
  candidates: FieldCandidate[];
}

export interface MergedExtraction {
  values: Record<string, any>;
  confidences: Record<string, number>;
  provenance: Record<string, { page: number; confidence: number; source_text: string }>;
  conflicts: ConflictProposal[];
}

function normValue(v: any): string {
  if (v == null) return '';
  if (typeof v === 'number') return `n:${v}`;
  if (typeof v === 'string') return `s:${norm(v)}`;
  try { return `o:${JSON.stringify(v)}`; } catch { return String(v); }
}

export function equalValues(a: any, b: any): boolean {
  return normValue(a) === normValue(b);
}

export function taskResultToCandidates(task: ExtractionTask, raw: any): (FieldCandidate & { field: string })[] {
  if (!raw || typeof raw !== 'object') return [];
  const conf = raw._confidence || {};
  const out: (FieldCandidate & { field: string })[] = [];
  for (const f of task.fields) {
    if (raw[f] == null || raw[f] === '') continue;
    out.push({
      field: f,
      value: raw[f],
      confidence: typeof conf[f] === 'number' ? conf[f] : 0.6,
      page: task.page,
      source_text: task.source_text,
    });
  }
  return out;
}

export function mergeExtractionResults(
  perField: Record<string, FieldCandidate[]>,
): MergedExtraction {
  const values: Record<string, any> = {};
  const confidences: Record<string, number> = {};
  const provenance: Record<string, { page: number; confidence: number; source_text: string }> = {};
  const conflicts: ConflictProposal[] = [];

  for (const [field, cands] of Object.entries(perField)) {
    const present = cands.filter((c) => c.value != null && c.value !== '');
    if (!present.length) continue;

    const distinct: FieldCandidate[] = [];
    for (const c of present) {
      if (!distinct.some((d) => equalValues(d.value, c.value))) distinct.push(c);
    }

    if (distinct.length === 1) {
      // Consensus (éventuellement plusieurs pages identiques) → on garde la
      // première occurrence la plus fiable + sa provenance.
      present.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      const best = present[0];
      values[field] = best.value;
      confidences[field] = best.confidence;
      provenance[field] = { page: best.page, confidence: best.confidence, source_text: best.source_text };
    } else {
      // Conflit réel : on ne choisit pas arbitrairement.
      const sorted = present.slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      conflicts.push({ field, status: 'unresolved', candidates: sorted });
      values[field] = null;
      confidences[field] = 0;
    }
  }

  return { values, confidences, provenance, conflicts };
}