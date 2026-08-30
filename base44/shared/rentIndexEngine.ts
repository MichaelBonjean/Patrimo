/**
 * MOTEUR DE RÉVISION DES LOYERS — calcul explicable.
 *
 * Indices supportés : IRL (habitation), ILC (bail commercial), ILAT (tertiaire),
 * "aucune" (pas de clause d'indexation au bail).
 *
 * Formule canonique (un警察forme pour tous les indices INSEE) :
 *   loyer révisé = loyer avant révision × (indice courant / indice de référence initial)
 *
 * Règles fiables et documentées ONLY :
 *  - Aucune révision si aucune clause d'indexation au bail.
 *  - Interdiction légale (loi Climat 2022) pour un lot classé DPE F ou G.
 *  - Une seule révision par an, à la date anniversaire (date_start si jamais
 *    révisé, sinon last_revision_date + 1 an).
 *  - Indices requis : valeur initiale ET valeur courante du même indice.
 *
 * Aucun plafonnement sectoriel, aucune proratisation n'est appliquée tant que
 * la source officielle n'est pas fiabilisée.
 */

const R2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n: number): string => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const INDEX_LABEL: Record<string, string> = {
  IRL: 'IRL (INSEE)',
  ILC: 'ILC (INSEE)',
  ILAT: 'ILAT (INSEE)',
};

/**
 * Sources officielles des indices — extension point pour la récupération
 * automatique ultérieure (INSEE). La fonction renvoie null tant que le
 * connecteur n'est pas branché ; aucune valeur n'est inventée.
 */
export const OFFICIAL_INDEX_SOURCES: Record<string, { provider: string; endpoint: string }> = {
  IRL: { provider: 'INSEE', endpoint: 'Indice de référence des loyers (mensuel / trimestriel)' },
  ILC: { provider: 'INSEE', endpoint: 'Indice des loyers commerciaux' },
  ILAT: { provider: 'INSEE', endpoint: 'Indice des loyers des activités tertiaires' },
};

export async function fetchOfficialIndex(_type: string, _quarter: string): Promise<number | null> {
  // À brancher : récupération automatique des indices publiés par l'INSEE.
  // Intentionnellement non connecté — on ne devine jamais une valeur d'indice.
  return null;
}

function addOneYear(iso: string): string {
  const base = iso ? new Date(iso) : new Date();
  if (isNaN(base.getTime())) return new Date().toISOString().slice(0, 10);
  base.setFullYear(base.getFullYear() + 1);
  return base.toISOString().slice(0, 10);
}

export interface RevisionInput {
  indexation_type: string;
  oldRent: number;
  oldIndexValue?: number | null;
  newIndexValue?: number | null;
  lastRevisionDate?: string | null;
  dateStart?: string | null;
  dpeClass?: string | null;
  proposalDate?: string | null;
}

export interface RevisionOutput {
  indexationType: string;
  oldRent: number;
  oldIndexValue: number | null;
  newIndexValue: number | null;
  newRent: number | null;
  variationAmount: number | null;
  variationPercent: number | null;
  formula: string;
  explanation: string;
  nextRevisionDate: string;
  canApply: boolean;
  blockedReason: string | null;
}

export function computeRevision(input: RevisionInput): RevisionOutput {
  const type = (input.indexation_type || 'aucune');
  const today = input.proposalDate || new Date().toISOString().slice(0, 10);
  const nextRevisionDate = addOneYear(input.lastRevisionDate || input.dateStart || today);
  const oldRent = R2(input.oldRent);
  const oldIdx = input.oldIndexValue != null && Number(input.oldIndexValue) > 0 ? Number(input.oldIndexValue) : null;
  const newIdx = input.newIndexValue != null && Number(input.newIndexValue) > 0 ? Number(input.newIndexValue) : null;

  const base = {
    indexationType: type,
    oldRent,
    oldIndexValue: oldIdx,
    newIndexValue: newIdx,
    nextRevisionDate,
  };

  if (type === 'aucune') {
    return {
      ...base, newRent: null, variationAmount: null, variationPercent: null,
      formula: 'Indexation désactivée.',
      explanation: "Aucune clause d'indexation n'est prévue au bail : le loyer ne peut pas être révisé.",
      canApply: false,
      blockedReason: 'Aucune indexation prévue au bail.',
    };
  }

  if (input.dpeClass === 'F' || input.dpeClass === 'G') {
    return {
      ...base, newRent: null, variationAmount: null, variationPercent: null,
      formula: 'Blocage légal DPE.',
      explanation: `Depuis 2022 (loi Climat), un logement classé DPE ${input.dpeClass} ne peut faire l'objet d'aucune révision de loyer.`,
      canApply: false,
      blockedReason: `Indexation interdite : DPE ${input.dpeClass} (loi Climat 2022).`,
    };
  }

  if (!oldIdx || !newIdx) {
    return {
      ...base, newRent: null, variationAmount: null, variationPercent: null,
      formula: 'Indices manquants.',
      explanation: "La révision nécessite l'indice de référence initial (à la signature ou dernière révision) et la dernière valeur publiée du même indice.",
      canApply: false,
      blockedReason: 'Indices manquants : renseignez l\'indice initial et l\'indice courant.',
    };
  }

  const ratio = newIdx / oldIdx;
  const newRent = R2(oldRent * ratio);
  const variationAmount = R2(newRent - oldRent);
  const variationPercent = R2(((newRent - oldRent) / oldRent) * 100);
  const canApply = today >= nextRevisionDate;
  const blockedReason = canApply ? null : `Révision éligible à partir du ${nextRevisionDate}.`;

  const idxLabel = INDEX_LABEL[type] || type;
  const formula = `${fmt(oldRent)} € × ${fmt(newIdx)} / ${fmt(oldIdx)} = ${fmt(newRent)} €`;
  let explanation = `${idxLabel} : loyer révisé = loyer avant révision × (indice courant / indice de référence). `;
  explanation += canApply
    ? `Éligible depuis le ${nextRevisionDate}. Le nouveau loyer ne s'applique qu'après validation expresse du bailleur.`
    : `Non applicable avant la date anniversaire (${nextRevisionDate}).`;

  return {
    ...base, newRent, variationAmount, variationPercent, formula, explanation,
    canApply, blockedReason,
  };
}