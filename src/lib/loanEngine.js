// Façade frontend du moteur de crédit canonique (ré-export du module partagé TS).
// Source unique de l'amortissement, du CRD et de la mensualité.
// Importer depuis @/lib/loanEngine — jamais recalculer le prêt ailleurs.

export {
  buildSchedule,
  currentCRD,
  scheduleAtPeriod,
  computeMonthlyPayment,
  getMonthlyPayment,
  scheduleTotals,
  addMonthsClamped,
} from '../../base44/shared/loanEngine';