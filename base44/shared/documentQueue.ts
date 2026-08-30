// Moteur CANONIQUE de la file d'analyse documentaire séquentielle de Patrimo.
// Moteur PUR (aucune I/O, aucun SDK) — source unique de vérité partagée entre :
//  - l'orchestrateur backend (base44/functions/processDocumentQueue/entry.ts)
//  - le pipeline d'ingestion (base44/functions/ingestDocument/entry.ts) pour
//    le calcul de progression
//  - le frontend (src/lib/documentQueue.js façade) pour l'affichage 3 groupes
//  - les tests (tests/unit/documentQueue.spec.js)
//
// RÈGLE D'OR : un seul document d'un même patrimoine en analyse technique
// active à la fois. Les statuts awaiting_review / paused / cancelled / failed
// NE bloquent PAS la file : seul le statut réellement actif empêche le suivant.

export const QUEUED = 'queued';
export const UPLOADED = 'uploaded';
export const OCR_RUNNING = 'ocr_running';
export const CLASSIFYING = 'classifying';
export const EXTRACTING = 'extracting';
export const PAUSED = 'paused';
export const AWAITING_REVIEW = 'awaiting_review';
export const COMMITTED = 'committed';
export const CANCELLED = 'cancelled';
export const FAILED = 'failed';
export const REJECTED = 'rejected';

// Statuts d'analyse technique active : un seul de ceux-ci à la fois par patrimoine.
export const ACTIVE_TECHNICAL = new Set([OCR_RUNNING, CLASSIFYING, EXTRACTING]);

// Statuts dit « queueable » : prêts à être démarrés par l'orchestrateur (FIFO).
// On accepte le legacy 'uploaded' pour ne pas casser les créations qui ne
// passent pas encore par le nouveau statut 'queued'.
export const QUEUEABLE = new Set([QUEUED, UPLOADED]);

// Statuts qui libèrent la file (le doc suivant peut démarrer).
export const UNBLOCKING = new Set([AWAITING_REVIEW, COMMITTED, CANCELLED, FAILED, PAUSED, REJECTED]);

// Heartbeat considéré comme périmé au-delà de : un lock orphelin est récupéré.
export const HEARTBEAT_STALE_MS = 15 * 60 * 1000;

export interface Doc {
  id: string;
  status: string;
  created_date?: string;
  queue_position?: number;
  last_heartbeat_at?: string;
  processing_started_at?: string;
  processing_lock_id?: string;
  last_checkpoint?: string;
  processed_pages?: number;
  ocr_text?: string;
  pause_reason?: string;
  pause_origin?: string;
  progress_percent?: number;
  current_stage?: string;
}

export function isActiveTechnical(d: any): boolean {
  return !!d && ACTIVE_TECHNICAL.has(d.status);
}

export function isQueueable(d: any): boolean {
  return !!d && QUEUEABLE.has(d.status);
}

export function heartbeatAgeMs(d: any, now: Date): number {
  const ts = d?.last_heartbeat_at || d?.processing_started_at || '';
  if (!ts) return Infinity;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return now.getTime() - t;
}

export function isStale(d: any, now: Date): boolean {
  return isActiveTechnical(d) && heartbeatAgeMs(d, now) > HEARTBEAT_STALE_MS;
}

export function findActive(docs: any[]): any[] {
  return (docs || []).filter(isActiveTechnical);
}

export function findOrphans(docs: any[], now: Date): any[] {
  return findActive(docs).filter((d) => isStale(d, now));
}

// Un document mis en pause système pour cause de quota mensuel épuisé bloque
// le démarrage de nouveaux documents (ils échoueraient immédiatement pareil).
export function findQuotaBlock(docs: any[]): any | null {
  return (docs || []).find(
    (d) => d?.status === PAUSED && d?.pause_origin === 'system' && /limite mensuelle/i.test(d?.pause_reason || ''),
  ) || null;
}

/**
 * Récupération d'un lock orphelin (analyse active sans heartbeat récent).
 * Si le document avait déjà progressé (OCR fait / checkpoint), on le met en
 * pause (erreur) pour reprise ultérieure sans tout recommencer.
 * Sinon (rien fait), on le remet en file (queued).
 */
export function recoverOrphan(d: any): { status: string; pause_reason?: string; pause_origin?: string } {
  const hasProgress =
    !!d?.last_checkpoint ||
    (Number(d?.processed_pages) || 0) > 0 ||
    (!!d?.ocr_text && String(d.ocr_text).trim().length > 0);
  if (hasProgress) {
    return {
      status: PAUSED,
      pause_origin: 'error',
      pause_reason: "Processus interrompu (heartbeat perdu). Reprenez l'analyse.",
    };
  }
  return { status: QUEUED };
}

// Prochain document à démarrer = FIFO (created_date asc, puis queue_position).
export function nextQueued(docs: any[]): any | null {
  const queued = (docs || []).filter(isQueueable);
  queued.sort((a, b) => {
    const ca = String(a.created_date || '').localeCompare(String(b.created_date || ''));
    if (ca !== 0) return ca;
    return (Number(a.queue_position) || 0) - (Number(b.queue_position) || 0);
  });
  return queued[0] || null;
}

export interface QueueDecision {
  shouldStart: boolean;
  reason: string; // ok | active_running | quota_exhausted | empty
  activeFresh: any[];
  orphans: any[];
  next?: any | null;
}

/**
 * Décision pure de l'orchestrateur. Ne démarre JAMAIS si un document est déjà
 * en analyse technique active (heartbeat frais) ou si le quota mensuel est
 * épuisé. Renvoie les orphelins à récupérer + le prochain candidat.
 */
export function decideQueue(docs: any[], now: Date): QueueDecision {
  const all = docs || [];
  const orphans = findOrphans(all, now);
  const activeFresh = findActive(all).filter((d) => !isStale(d, now));

  if (findQuotaBlock(all)) {
    return { shouldStart: false, reason: 'quota_exhausted', activeFresh, orphans };
  }
  if (activeFresh.length > 0) {
    return { shouldStart: false, reason: 'active_running', activeFresh, orphans };
  }
  const next = nextQueued(all);
  if (!next) return { shouldStart: false, reason: 'empty', activeFresh, orphans };
  return { shouldStart: true, reason: 'ok', activeFresh, orphans, next };
}

/**
 * Patch de claim posé par l'orchestrateur au démarrage. Le processing_lock_id
 * garantit l'unicité : ingestDocument ne poursuit QUE si son lock_id reçu
 * correspond à processing_lock_id stocké (pg perdu de justesse → abandon propre).
 */
export function claimPatch(lockId: string, now: Date) {
  return {
    status: OCR_RUNNING,
    processing_lock_id: lockId,
    processing_started_at: now.toISOString(),
    last_heartbeat_at: now.toISOString(),
    analysis_started_at: now.toISOString(),
    current_stage: 'ocr',
    progress_percent: 8,
    pause_requested: false,
    cancellation_requested: false,
  };
}

export function canIngestProceed(d: any, lockId: string): boolean {
  if (!d) return false;
  // Pas de verrou posé → appel direct / legacy / test autorisé. L'orchestrateur
  // reste le gardien du « un à la fois » ; en production tout passe par lui
  // (claim + lock_id correspondant). On n'interdit que si un verrou existe
  // réellement et qu'il ne correspond pas.
  if (!d.processing_lock_id) return true;
  // Document verrouillé par l'orchestrateur : seul le détenteur du lock poursuit.
  if (!lockId) return false;
  return d.processing_lock_id === lockId;
}

// Pondération centrale de la progression réelle (pas de fausse animation).
// Upload 0-10 · OCR 10-35 · Classification 35-45 · Extraction 45-85 · Merge 85-95 · Validation 95-100.
export function progressForStage(stage: string, processedPages?: number, totalPages?: number): number {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  switch (stage) {
    case 'queued':
    case 'ocr':
      return 10;
    case 'ocr_done':
    case 'classifying':
      return 38;
    case 'extraction': {
      const tp = Number(totalPages) || 0;
      const pp = Number(processedPages) || 0;
      if (tp > 1 && pp > 0) return clamp(45 + (pp / tp) * 40); // 45..85
      return 50;
    }
    case 'merging':
      return 90;
    case 'awaiting_review':
    case 'committed':
      return 100;
    default:
      return 0;
  }
}

// Positions d'affichage FIFO (pour « En attente — position 3 »).
export function computeQueuePositions(docs: any[]): Record<string, number> {
  const queued = (docs || [])
    .filter(isQueueable)
    .sort(
      (a, b) =>
        String(a.created_date || '').localeCompare(String(b.created_date || '')) ||
        (Number(a.queue_position) || 0) - (Number(b.queue_position) || 0),
    );
  const map: Record<string, number> = {};
  queued.forEach((d, i) => {
    map[d.id] = i + 1;
  });
  return map;
}