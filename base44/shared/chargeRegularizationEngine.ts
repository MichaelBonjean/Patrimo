/**
 * MOTEUR DE RÉGULARISATION DES CHARGES LOCATIVES.
 *
 * Distinction stricte :
 *  - provisions encaissées   : part « charges » prélevée chaque mois au locataire
 *    (RentDue.charges sur la période). Ne concerne QUE les provisions locataire.
 *  - charges récupérables    : dépenses réellement engagées par le bailleur et
 *    refacturables au locataire (eau, chauffage collectif, TEOM, ascenseur…).
 *    Catalogue dédié RECOVERABLE_CATEGORIES — JAMAIS les charges propriétaire
 *    (intérets, PNO propriétaire, frais de gestion, etc.) qui ne se refacturent
 *    pas.
 *
 * Solde = charges récupérables - provisions encaissées.
 *  - solde > 0  : dû par le locataire
 *  - solde < 0  : à rembourser au locataire
 *  - solde = 0  : régularisation nulle
 */

const R2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface VentilationLine {
  category: string;
  category_label: string;
  amount: number;
  note?: string;
}

/** Catalogue dédié des charges récupérables locataire (clés stables). */
export const RECOVERABLE_CATEGORIES: { key: string; label: string }[] = [
  { key: 'water', label: 'Eau (partie récupérable)' },
  { key: 'hot_water', label: 'Eau chaude' },
  { key: 'heating_common', label: 'Chauffage collectif' },
  { key: 'common_electricity', label: 'Électricité parties communes' },
  { key: 'elevator', label: 'Ascenseur' },
  { key: 'common_maintenance', label: 'Entretien parties communes' },
  { key: 'janitor', label: 'Gardiennage / concierge' },
  { key: 'teom', label: 'TEOM (ordures ménagères)' },
  { key: 'diagnostics', label: 'Diagnostics obligatoires' },
  { key: 'other_recoverable', label: 'Autre charge récupérable' },
];

export const RECOVERABLE_LABEL: Record<string, string> = Object.fromEntries(
  RECOVERABLE_CATEGORIES.map((c) => [c.key, c.label]),
);

export type RegDirection = 'du_locataire' | 'rembourser_locataire' | 'solde_nul';

export interface RegCompute {
  provisions_collected: number;
  recoverable_total: number;
  teom_recoverable: number;
  solde: number;
  direction: RegDirection;
}

export function labelOfRecoverable(key: string): string {
  return RECOVERABLE_LABEL[key] ?? key;
}

export function computeRegularization(
  provisions: number,
  ventilation: VentilationLine[],
): RegCompute {
  const provisions_collected = R2(provisions);
  const recoverable_total = R2(
    (ventilation || []).reduce((s, v) => s + (Number(v.amount) || 0), 0),
  );
  const teom_recoverable = R2(
    (ventilation || [])
      .filter((v) => v.category === 'teom')
      .reduce((s, v) => s + (Number(v.amount) || 0), 0),
  );
  const solde = R2(recoverable_total - provisions_collected);
  const direction: RegDirection =
    solde > 0 ? 'du_locataire' : solde < 0 ? 'rembourser_locataire' : 'solde_nul';
  return { provisions_collected, recoverable_total, teom_recoverable, solde, direction };
}