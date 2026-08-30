import { describe, it, expect } from 'vitest';
import {
  QUEUED, UPLOADED, OCR_RUNNING, CLASSIFYING, EXTRACTING, PAUSED,
  AWAITING_REVIEW, COMMITTED, CANCELLED, FAILED, REJECTED,
  ACTIVE_TECHNICAL, QUEUEABLE, HEARTBEAT_STALE_MS,
  isActiveTechnical, isQueueable, isStale, findActive, findOrphans,
  findQuotaBlock, recoverOrphan, nextQueued, decideQueue, claimPatch,
  canIngestProceed, progressForStage, computeQueuePositions,
} from '../../src/lib/documentQueue';

const NOW = new Date('2026-08-30T15:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms) => new Date(NOW.getTime() + ms).toISOString();

const mk = (over = {}) => ({
  id: over.id || 'd1',
  status: over.status || QUEUED,
  created_date: over.created_date || '2026-08-30T10:00:00Z',
  queue_position: over.queue_position ?? 1,
  ...over,
});

describe('documentQueue — state machine', () => {
  it('reconnaît uniquement ocr_running/classifying/extracting comme analyse active', () => {
    expect(ACTIVE_TECHNICAL.has(OCR_RUNNING)).toBe(true);
    expect(ACTIVE_TECHNICAL.has(CLASSIFYING)).toBe(true);
    expect(ACTIVE_TECHNICAL.has(EXTRACTING)).toBe(true);
    expect(ACTIVE_TECHNICAL.has(AWAITING_REVIEW)).toBe(false);
    expect(ACTIVE_TECHNICAL.has(PAUSED)).toBe(false);
    expect(ACTIVE_TECHNICAL.has(QUEUED)).toBe(false);
  });

  it('queued et uploaded sont démarrables (FIFO)', () => {
    expect(QUEUEABLE.has(QUEUED)).toBe(true);
    expect(QUEUEABLE.has(UPLOADED)).toBe(true);
    expect(QUEUEABLE.has(OCR_RUNNING)).toBe(false);
  });
});

// 1. 1 document → démarre.
describe('1. document unique → démarre', () => {
  it('décide de démarrer un document seul en queue', () => {
    const docs = [mk({ id: 'a', status: QUEUED })];
    const d = decideQueue(docs, NOW);
    expect(d.shouldStart).toBe(true);
    expect(d.next?.id).toBe('a');
  });
});

// 2. 3 documents → un seul actif.
describe('2. plusieurs documents → un seul actif', () => {
  it('ne démarre pas si un document est déjà en analyse active', () => {
    const docs = [
      mk({ id: 'a', status: OCR_RUNNING, last_heartbeat_at: ago(1000) }),
      mk({ id: 'b', status: QUEUED, created_date: '2026-08-30T10:01:00Z' }),
      mk({ id: 'c', status: QUEUED, created_date: '2026-08-30T10:02:00Z' }),
    ];
    const d = decideQueue(docs, NOW);
    expect(d.shouldStart).toBe(false);
    expect(d.reason).toBe('active_running');
    expect(d.activeFresh).toHaveLength(1);
  });
});

// 3. doc1 terminé (committed) → doc2 démarre.
describe('3. document 1 committed → document 2 démarre', () => {
  it('committed ne bloque pas la file', () => {
    const docs = [
      mk({ id: 'a', status: COMMITTED }),
      mk({ id: 'b', status: QUEUED, created_date: '2026-08-30T10:01:00Z' }),
    ];
    const d = decideQueue(docs, NOW);
    expect(d.shouldStart).toBe(true);
    expect(d.next?.id).toBe('b');
  });
});

// 4. doc1 awaiting_review → doc2 démarre.
describe('4. document 1 awaiting_review → document 2 démarre', () => {
  it('awaiting_review ne bloque pas la file', () => {
    const docs = [
      mk({ id: 'a', status: AWAITING_REVIEW }),
      mk({ id: 'b', status: QUEUED, created_date: '2026-08-30T10:01:00Z' }),
    ];
    const d = decideQueue(docs, NOW);
    expect(d.shouldStart).toBe(true);
    expect(d.next?.id).toBe('b');
  });
});

// 5. doc1 paused → doc2 démarre.
describe('5. document 1 paused → document 2 démarre', () => {
  it('paused ne bloque pas la file', () => {
    const docs = [
      mk({ id: 'a', status: PAUSED, pause_origin: 'error' }),
      mk({ id: 'b', status: QUEUED, created_date: '2026-08-30T10:01:00Z' }),
    ];
    const d = decideQueue(docs, NOW);
    expect(d.shouldStart).toBe(true);
    expect(d.next?.id).toBe('b');
  });
});

// 6. doc1 failed → doc2 démarre.
describe('6. document 1 failed → document 2 démarre', () => {
  it('failed ne bloque pas la file', () => {
    const docs = [
      mk({ id: 'a', status: FAILED }),
      mk({ id: 'b', status: QUEUED, created_date: '2026-08-30T10:01:00Z' }),
    ];
    const d = decideQueue(docs, NOW);
    expect(d.shouldStart).toBe(true);
    expect(d.next?.id).toBe('b');
  });
});

// 7. deux requêtes concurrentes → jamais deux documents actifs (verrou).
describe('7. concurrence — verrou logique', () => {
  it('le claim posé par l\'orchestrateur embarque un processing_lock_id', () => {
    const lock = 'LOCK-A';
    const p = claimPatch(lock, NOW);
    expect(p.processing_lock_id).toBe(lock);
    expect(p.status).toBe(OCR_RUNNING);
    expect(p.last_heartbeat_at).toBeDefined();
  });

  it('canIngestProceed : seul le détenteur du lock poursuit, l\'autre abandonne', () => {
    const rec = mk({ id: 'a', status: OCR_RUNNING, processing_lock_id: 'LOCK-A' });
    expect(canIngestProceed(rec, 'LOCK-A')).toBe(true);
    expect(canIngestProceed(rec, 'LOCK-B')).toBe(false);
  });

  it('deux claims concurrents sur le même doc : le perdant n\'avance pas', () => {
    // Behaviour pure : canIngestProceed garantit qu'un seul ingestDocument poursuit.
    const docAfterBWins = mk({ id: 'a', status: OCR_RUNNING, processing_lock_id: 'LOCK-B' });
    const winnerA = canIngestProceed(docAfterBWins, 'LOCK-A');
    const winnerB = canIngestProceed(docAfterBWins, 'LOCK-B');
    expect(winnerA).toBe(false);
    expect(winnerB).toBe(true);
    // Au plus un gagnant.
    expect([winnerA, winnerB].filter(Boolean).length).toBeLessThanOrEqual(1);
  });
});

// 8. queue FIFO.
describe('8. ordre FIFO de la file', () => {
  it('nextQueued renvoie le plus ancien (created_date)', () => {
    const docs = [
      mk({ id: 'c', created_date: '2026-08-30T10:02:00Z' }),
      mk({ id: 'a', created_date: '2026-08-30T10:00:00Z' }),
      mk({ id: 'b', created_date: '2026-08-30T10:01:00Z' }),
    ];
    expect(nextQueued(docs)?.id).toBe('a');
  });

  it('computeQueuePositions attribue les rangs FIFO', () => {
    const docs = [
      mk({ id: 'c', created_date: '2026-08-30T10:02:00Z' }),
      mk({ id: 'a', created_date: '2026-08-30T10:00:00Z' }),
      mk({ id: 'b', created_date: '2026-08-30T10:01:00Z' }),
      mk({ id: 'done', created_date: '2026-08-30T09:00:00Z', status: COMMITTED }),
    ];
    expect(computeQueuePositions(docs)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('uploaded est démarrable dans l\'ordre FIFO (rétro-compat)', () => {
    const docs = [
      mk({ id: 'old', status: UPLOADED, created_date: '2026-08-30T09:00:00Z' }),
      mk({ id: 'new', status: QUEUED, created_date: '2026-08-30T10:00:00Z' }),
    ];
    expect(nextQueued(docs)?.id).toBe('old');
  });
});

// 9. lock orphelin.
describe('9. lock orphelin (heartbeat périmé)', () => {
  it('détecte un actif sans heartbeat récent comme orphelin', () => {
    const docs = [mk({ id: 'a', status: EXTRACTING, last_heartbeat_at: ago(HEARTBEAT_STALE_MS + 60000) })];
    const orphans = findOrphans(docs, NOW);
    expect(orphans).toHaveLength(1);
  });

  it('un actif frais n\'est pas orphelin', () => {
    const docs = [mk({ id: 'a', status: EXTRACTING, last_heartbeat_at: ago(20000) })];
    expect(findOrphans(docs, NOW)).toHaveLength(0);
  });

  it('decideQueue expose les orphelins à récupérer', () => {
    const docs = [
      mk({ id: 'a', status: EXTRACTING, last_heartbeat_at: ago(HEARTBEAT_STALE_MS + 60000) }),
      mk({ id: 'b', status: QUEUED }),
    ];
    const d = decideQueue(docs, NOW);
    expect(d.orphans).toHaveLength(1);
    expect(d.shouldStart).toBe(true); // orphelin récupéré → le suivant démarre
    expect(d.next?.id).toBe('b');
  });
});

// 10. retry après crash (orphan) — reprise selon checkpoint.
describe('10. retry / récupération après crash', () => {
  it('orphelin avec progression → paused (erreur) pour reprise sans tout rejouer', () => {
    const doc = mk({
      id: 'a', status: EXTRACTING,
      last_heartbeat_at: ago(HEARTBEAT_STALE_MS + 60000),
      last_checkpoint: 'extraction_chunk_12_complete', processed_pages: 13,
    });
    const r = recoverOrphan(doc);
    expect(r.status).toBe(PAUSED);
    expect(r.pause_origin).toBe('error');
    expect(r.pause_reason).toMatch(/heartbeat perdu/);
  });

  it('orphelin sans progression (rien fait) → remis en queue', () => {
    const doc = mk({
      id: 'a', status: OCR_RUNNING,
      last_heartbeat_at: ago(HEARTBEAT_STALE_MS + 60000),
    });
    const r = recoverOrphan(doc);
    expect(r.status).toBe(QUEUED);
  });

  it('orphelin avec OCR déjà fait mais sans checkpoint explicite → paused (grâce à ocr_text)', () => {
    const doc = mk({
      id: 'a', status: EXTRACTING,
      last_heartbeat_at: ago(HEARTBEAT_STALE_MS + 60000),
      ocr_text: 'Extrait du document déjà obtenu…',
    });
    const r = recoverOrphan(doc);
    expect(r.status).toBe(PAUSED);
  });
});

// Bonus : quota épuisé bloque la file (limite mensuelle).
describe('quota mensuel épuisé — la file ne démarre plus', () => {
  it('un document paused(system) « limite mensuelle » bloque le démarrage', () => {
    const docs = [
      mk({ id: 'a', status: PAUSED, pause_origin: 'system', pause_reason: 'Limite mensuelle atteinte — reprenrez…' }),
      mk({ id: 'b', status: QUEUED }),
    ];
    const d = decideQueue(docs, NOW);
    expect(d.shouldStart).toBe(false);
    expect(d.reason).toBe('quota_exhausted');
    expect(findQuotaBlock(docs)?.id).toBe('a');
  });

  it('une pause utilisateur NE bloque pas la file', () => {
    const docs = [
      mk({ id: 'a', status: PAUSED, pause_origin: 'user', pause_reason: 'Pause demandée' }),
      mk({ id: 'b', status: QUEUED }),
    ];
    const d = decideQueue(docs, NOW);
    expect(d.shouldStart).toBe(true);
    expect(d.next?.id).toBe('b');
  });
});

// Bonus : progression réelle (pas de fausse animation).
describe('progression réelle pondérée', () => {
  it('upload=10, classifying=38, merging=90, awaiting_review=100', () => {
    expect(progressForStage('ocr')).toBe(10);
    expect(progressForStage('classifying')).toBe(38);
    expect(progressForStage('merging')).toBe(90);
    expect(progressForStage('awaiting_review')).toBe(100);
  });

  it('extraction chunkée croît linéairement entre 45 et 85', () => {
    expect(progressForStage('extraction', 1, 10)).toBeGreaterThanOrEqual(45);
    expect(progressForStage('extraction', 10, 10)).toBeLessThanOrEqual(86);
    expect(progressForStage('extraction', 5, 10)).toBe(65);
  });

  it('queue vide → nextQueued null + decideQueue empty', () => {
    expect(nextQueued([])).toBeNull();
    expect(decideQueue([], NOW).reason).toBe('empty');
  });
});