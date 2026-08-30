/**
 * Textes juridiques des quittances de loyer — source unique centralisée.
 *
 * Objectifs :
 *  - centraliser les mentions (plus de références éparpillées dans le PDF) ;
 *  - permettre une mise à jour en un seul endroit ;
 *  - éviter les références juridiques incorrectes ou inutiles dans le document.
 *
 * Base légale (vérifiée) : art. 21 de la loi n° 89-462 du 6 juillet 1989 —
 * le bailleur transmet gratuitement une quittance au locataire qui en fait la
 * demande. En cas de paiement incomplet, il délivre un reçu du montant versé.
 */

export const LEGAL_MENTION_FULL =
  "Quittance de loyer délivrée gratuitement conformément à l'article 21 de la " +
  "loi n° 89-462 du 6 juillet 1989. La présente quittance fait foi du règlement " +
  "intégral des sommes indiquées pour la période concernée et tient lieu de décharge.";

export const LEGAL_MENTION_PARTIAL =
  "Reçu pour paiement partiel, délivré gratuitement conformément à l'article 21 " +
  "de la loi n° 89-462 du 6 juillet 1989. En cas de paiement incomplet, le " +
  "bailleur délivre un reçu du montant effectivement réglé par le locataire. " +
  "Le solde reste dû pour la période concernée.";

/** Sélectionne la mention légale selon le type de document. */
export function legalMentionFor(kind: string): string {
  return kind === 'partial' ? LEGAL_MENTION_PARTIAL : LEGAL_MENTION_FULL;
}