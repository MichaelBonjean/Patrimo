// Façade frontend (ré-export) du moteur canonique de file d'analyse documentaire.
// Source unique de vérité : base44/shared/documentQueue.ts. Aucune règle métier
// dupliquée ici — uniquement la réexport pour l'UI et les tests unitaires.
export {
  QUEUED, UPLOADED, OCR_RUNNING, CLASSIFYING, EXTRACTING, PAUSED,
  AWAITING_REVIEW, COMMITTED, CANCELLED, FAILED, REJECTED,
  ACTIVE_TECHNICAL, QUEUEABLE, UNBLOCKING, HEARTBEAT_STALE_MS,
  isActiveTechnical, isQueueable, isStale, heartbeatAgeMs,
  findActive, findOrphans, findQuotaBlock, recoverOrphan, nextQueued,
  decideQueue, claimPatch, canIngestProceed, progressForStage,
  computeQueuePositions,
} from '../../base44/shared/documentQueue.ts';