// Façade frontend du moteur de réconciliation bancaire canonique (ré-export).
// Source unique : base44/shared/bankReconcileEngine.ts. Importer depuis
// @/lib/bankReconcileEngine — jamais recalculer le rapprochement ailleurs.

export {
  THRESHOLDS, LEVELS, levelFromConfidence,
  normalizeDescription, tokens, tokenSimilarity, nameCited,
  isStructureHolderType,
  applyRules, matchRent, matchLoan, detectInternalTransfer, defaultExpenseScope,
  reconcileBankTransaction, aggregateReconcile, computeRealCashflow, suggestRuleFromProposal,
} from '../../base44/shared/bankReconcileEngine';