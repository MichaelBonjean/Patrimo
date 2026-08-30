// Façade frontend du moteur de rentabilité canonique (ré-export du module TS).
// Importer depuis @/lib/performanceEngine — jamais recomputer une rentabilité ailleurs.
export {
  computeAcquisitionCost,
  theoreticalAnnualRent,
  nonRecoverableOpEx,
  investedCapitalOf,
  computePropertyPerformance,
  computePortfolioPerformance,
  getPerformanceBreakdown,
} from '../../base44/shared/performanceEngine';