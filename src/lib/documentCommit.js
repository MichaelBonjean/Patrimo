// Façade frontend du moteur canonique de commit documentaire (ré-export du module TS).
// Source unique de vérité : base44/shared/documentCommit.ts.
// Importer depuis @/lib/documentCommit — ne JAMAIS dupliquer de règle métier ici.
export {
  CLASSIFICATION_TYPES,
  LEGAL_ENTITY_TYPES,
  isLegalEntity,
  norm,
  matchPropertyByAddress,
  matchLeaseByTenant,
  matchHolderByName,
  mapLegalType,
  matchLegalEntity,
  matchPersonHolder,
  computePercentFromShares,
  validateCapitalStructure,
  buildCommitPlan,
  acteDeVenteCommitPlan,
  leaseCommitPlan,
  loanCommitPlan,
  legalEntityCommitPlan,
  splitAddress,
} from '../../base44/shared/documentCommit';