// Façade frontend du moteur financier canonique (ré-export du module partagé TS).
// Importer depuis @/lib/financeEngine — jamais recompter le cash-flow ailleurs.

export {
  computePropertyCashflow,
  computePortfolioCashflow,
  monthlyNetCashflowSeries,
  cashflowBucketOf,
  resolveKey,
  directionOf,
} from '../../base44/shared/financeEngine';