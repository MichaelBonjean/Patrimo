/**
 * Capital Restant Dû (CRD) — délègue au moteur de crédit canonique
 * (@/lib/loanEngine → base44/shared/loanEngine). Aucun recomptage ici.
 */
export { currentCRD as calcCurrentCRD } from './loanEngine';