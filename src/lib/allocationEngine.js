// Façade frontend du moteur d'affectation financière (ré-export du shared).
// Source unique : base44/shared/allocationEngine.ts.

export {
  computeVentilation,
  validateVentilation,
  resolveAllocationType,
  hasValidAllocation,
  attributeAllocations,
  consolidatedTransferNet,
  deriveAllocationType,
} from '../../base44/shared/allocationEngine';