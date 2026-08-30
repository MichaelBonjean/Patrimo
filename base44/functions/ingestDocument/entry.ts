import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets, waitUntil } from 'base44:runtime';
import {
  CLASSIFICATION_TYPES, classifyPrompt, extractionPrompt, extractorSchema,
  maskSensitive, maskObject, clampConf, labelFor,
} from '../../shared/documentExtractors.ts';
import { classifyDocument, CONFIDENCE_THRESHOLD } from '../../shared/documentClassifier.ts';
import {
  splitTextIntoPages, hasSectionTargets, buildExtractionTasks,
  taskResultToCandidates, mergeExtractionResults, CHUNK_THRESHOLD,
} from '../../shared/documentExtractionEngine.ts';
import { sendPush } from '../../shared/notify.ts';
import { canIngestProceed, progressForStage } from '../../shared/documentQueue.ts';

/**
 * ingestDocument — pipeline d'ingestion IA d'un document immobilier.
 *
 * Payload : { document_import_id, lock_id? }
 *
 *  a. charge l'enregistrement DocumentImport (isolation RLS owner_id) ;
 *  b. vérifie le verrou de file (lock_id) : si un autre claim a gagné, abandon
 *     propre (garantit un seul document analysé à la fois) ;
 *  c. extraction texte : Mistral OCR si MISTRAL_API_KEY, sinon InvokeLLM vision ;
 *  d. classification LLM courte (8 types) sur les 2000 premiers caractères ;
 *  e. extraction structurée spécialisée selon le type (chunked si doc long) ;
 *  f. masquage RGPD (IBAN / CB / SSN) de l'ocr_text et des extracted_data ;
 *  g. status = 'awaiting_review', cost_cents renseigné ;
 *  h. push "Votre {type} est prêt à valider" ;
 *  i. heartbeats + progression réelle persistées à chaque étape ;
 *  j. finally : déclenche l'orchestrateur pour démarrer le document suivant.
 *
 * Garde-fous :
 *  - fichier > 20 Mo → rejected ;
 *  - rate-limit mensuel par plan (starter 3, pro 20, business 200) → paused(system)
 *    afin de libérer la file (les autres documents ne seront pas analysés tant
 *    que le quota est épuisé — see documentQueue.findQuotaBlock) ;
 *  - PDF chiffré / corrompu → failed ; lock libéré ;
 *  - > 20 pages → traité + warning.
 */

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const DAY_MS = 86400000;
const INGEST_LIMITS: Record<string, number> = { starter: 3, pro: 20, business: 200 };
const COST_PER_PAGE_CENTS: Record<string, number> = { ocr: 5, vision: 3 };

function effectivePlan(user: any): string {
  if (!user) return 'starter';
  const status = user.subscription_status || 'none';
  const plan = user.plan || 'starter';
  if (['active', 'trialing', 'past_due', 'canceled'].includes(status)) return plan;
  const trialEnd = user.trial_ends_at
    ? new Date(user.trial_ends_at).getTime()
    : user.created_date
      ? new Date(user.created_date).getTime() + 14 * DAY_MS
      : 0;
  if (trialEnd && Date.now() < trialEnd) return 'business';
  return 'starter';
}

async function runMistralOCR(fileUrl: string, apiKey: string): Promise<{ text: string; pages: number; pageTexts: string[] }> {
  const res = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: { type: 'document_url', document_url: fileUrl },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Mistral OCR ' + res.status + ': ' + t.slice(0, 200));
  }
  const j: any = await res.json();
  const pages: any[] = Array.isArray(j?.pages) ? j.pages : [];
  const pageTexts = pages.map((p) => p?.markdown || p?.text || '');
  const text = pageTexts.join('\n\n');
  return { text, pages: pages.length || 1, pageTexts };
}

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  let docId: string | null = null;
  try {
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const id = body?.document_import_id;
    if (!id) return Response.json({ error: 'document_import_id requis' }, { status: 400 });

    const svc = base44.asServiceRole;
    const mine = await svc.entities.DocumentImport.filter({ owner_id: user.email });
    const rec = (mine || []).find((r: any) => r.id === id);
    if (!rec) return Response.json({ error: 'Document introuvable' }, { status: 404 });
    docId = rec.id;

    // --- b. Vérification du verrou de file (un seul document à la fois) -----
    const lockId = body?.lock_id;
    if (!canIngestProceed(rec, lockId)) {
      // Un autre claim a gagné la course : on n'écrit rien (le gagnant possède le
      // document) et on abandonne proprement. La file n'est pas avancée par ici.
      return Response.json({ aborted: true, reason: 'lock_lost' });
    }

    // --- Fichier > 20 Mo ---------------------------------------------------
    if (rec.file_size && Number(rec.file_size) > MAX_FILE_SIZE) {
      await svc.entities.DocumentImport.update(rec.id, {
        status: 'rejected', error_message: 'Fichier supérieur à 20 Mo',
        processing_lock_id: null, analysis_finished_at: new Date().toISOString(),
      } as any);
      return Response.json({ error: 'Fichier supérieur à 20 Mo' }, { status: 413 });
    }

    // --- Rate-limit mensuel par plan → paused(system) (libère la file) -----
    const plan = effectivePlan(user);
    const limit = INGEST_LIMITS[plan] ?? 3;
    const sinceMs = Date.now() - 30 * DAY_MS;
    const myDocs = await svc.entities.DocumentImport.filter({ user_id: user.id });
    const recentCount = (myDocs || []).filter((r: any) => {
      if (!r.created_date) return false;
      if (r.status === 'rejected' || r.status === 'failed') return false;
      return new Date(r.created_date).getTime() >= sinceMs;
    }).length;
    if (recentCount >= limit) {
      await svc.entities.DocumentImport.update(rec.id, {
        status: 'paused', pause_origin: 'system',
        pause_reason: 'Limite mensuelle atteinte — reprenrez l’analyse le mois prochain (passez au plan supérieur pour continuer).',
        processing_lock_id: null, analysis_finished_at: new Date().toISOString(),
      } as any);
      return Response.json(
        { error: 'Limite mensuelle atteinte, passez au plan supérieur pour continuer', plan, used: recentCount, limit },
        { status: 429 },
      );
    }

    // --- c. Extraction texte (OCR) — claim/heartbeat progressive ------------
    const nowISO = () => new Date().toISOString();
    await svc.entities.DocumentImport.update(rec.id, {
      status: 'ocr_running', current_stage: 'ocr', progress_percent: 10, last_heartbeat_at: nowISO(),
    } as any);

    let ocrText = '';
    let pagesCount = 1;
    let engine = 'vision';
    let pageTexts: string[] = [];
    const mistralKey = secrets.get('MISTRAL_API_KEY');
    try {
      if (mistralKey) {
        const ocr = await runMistralOCR(rec.file_url, mistralKey);
        ocrText = ocr.text || '';
        pagesCount = ocr.pages || 1;
        pageTexts = ocr.pageTexts || (ocrText ? [ocrText] : []);
        engine = 'ocr';
      } else {
        const t: any = await base44.integrations.Core.InvokeLLM({
          prompt: 'Transcris intégralement le document fourni. Réponds JSON {text, pages_count}.',
          file_urls: [rec.file_url],
          response_json_schema: {
            type: 'object',
            properties: { text: { type: 'string' }, pages_count: { type: 'number' } },
          },
        });
        ocrText = (t && t.text) || '';
        pagesCount = Number(t?.pages_count) || 1;
        pageTexts = splitTextIntoPages(ocrText, pagesCount);
        engine = 'vision';
      }
    } catch (e: any) {
      const msg = e?.message || 'Extraction texte échouée';
      await svc.entities.DocumentImport.update(rec.id, {
        status: 'failed', error_message: 'Document non traitable : ' + msg,
        processing_lock_id: null, analysis_finished_at: nowISO(),
      } as any);
      return Response.json({ error: 'Document non traitable', details: msg }, { status: 422 });
    }

    if (!ocrText || ocrText.trim().length < 20) {
      await svc.entities.DocumentImport.update(rec.id, {
        status: 'failed',
        error_message: 'Texte non extractible (PDF chiffré, protégé ou image illisible)',
        processing_lock_id: null, analysis_finished_at: nowISO(),
      } as any);
      return Response.json({ error: 'Texte non extractible (PDF chiffré, protégé ou image illisible)' }, { status: 422 });
    }

    const maskedText = maskSensitive(ocrText);
    const maskedPages = pageTexts.map((p) => maskSensitive(p));
    await svc.entities.DocumentImport.update(rec.id, {
      status: 'extracting',
      current_stage: 'classifying', progress_percent: 38,
      ocr_text: maskedText, pages_count: pagesCount, total_pages: pagesCount, processed_pages: 0,
      last_checkpoint: 'ocr_complete', last_heartbeat_at: nowISO(),
    } as any);

    // --- d. Classification --------------------------------------------------
    const heuristic = classifyDocument(rec.file_name, maskedText);
    let classification = heuristic.type;
    let conf = heuristic.confidence;
    let reason = heuristic.explanation;
    let alternatives: any[] = heuristic.alternatives;

    if (conf < CONFIDENCE_THRESHOLD) {
      try {
        const c: any = await base44.integrations.Core.InvokeLLM({
          prompt: classifyPrompt(maskedText),
          response_json_schema: {
            type: 'object',
            properties: { type: { type: 'string' }, confidence: { type: 'number' }, reason: { type: 'string' } },
          },
        });
        const llmType = CLASSIFICATION_TYPES.includes(c?.type) ? c.type : 'autre';
        const llmConf = clampConf(c?.confidence);
        if (llmConf > conf) {
          classification = llmType;
          conf = llmConf;
          reason = c?.reason || heuristic.explanation;
        } else if (c?.reason) {
          reason = (heuristic.explanation || '') + ' | LLM : ' + c.reason;
        }
      } catch {
        /* on conserve le résultat heuristique */
      }
    }
    await svc.entities.DocumentImport.update(rec.id, {
      current_stage: 'extraction', progress_percent: 45,
      classification, classification_confidence: conf, classification_explanation: reason,
      last_checkpoint: 'classification_complete', last_heartbeat_at: nowISO(),
    } as any);

    // --- e. Extraction structurée (chunked si doc long, sinon single-pass) -
    let extracted: any = {};
    let confFields: any = {};
    let provenance: any = {};
    let extractionConflicts: any[] = [];
    let extractionMode = 'single';
    try {
      const useChunked = pagesCount > CHUNK_THRESHOLD && hasSectionTargets(classification);
      if (useChunked) {
        extractionMode = 'chunked';
        const tasks = buildExtractionTasks({ classification, pages: maskedPages });
        const perField: Record<string, any[]> = {};
        let processedChunks = 0;
        for (const task of tasks) {
          try {
            const r: any = await base44.integrations.Core.InvokeLLM({
              prompt: task.prompt,
              response_json_schema: task.json_schema,
            });
            for (const c of taskResultToCandidates(task, r)) {
              (perField[c.field] || (perField[c.field] = [])).push({
                value: c.value, confidence: c.confidence, page: c.page, source_text: c.source_text,
              });
            }
          } catch {
            /* tâche d'extraction échouée -> chunk non contributif, ignoré */
          }
          processedChunks++;
          await svc.entities.DocumentImport.update(rec.id, {
            current_stage: 'extraction',
            progress_percent: progressForStage('extraction', processedChunks, tasks.length),
            processed_pages: processedChunks,
            last_checkpoint: `extraction_chunk_${processedChunks}_complete`,
            last_heartbeat_at: nowISO(),
          } as any);
        }
        const merged = mergeExtractionResults(perField);
        extracted = maskObject(merged.values);
        confFields = merged.confidences;
        provenance = merged.provenance;
        extractionConflicts = merged.conflicts;
      } else {
        const schema = extractorSchema(classification);
        const ex: any = await base44.integrations.Core.InvokeLLM({
          prompt: extractionPrompt(classification, maskedText),
          file_urls: [rec.file_url],
          response_json_schema: schema,
        });
        extracted = (ex && ex.extracted_data) ? ex.extracted_data : (ex || {});
        confFields = (ex && ex.confidence_per_field) ? ex.confidence_per_field : {};
        extracted = maskObject(extracted);
        await svc.entities.DocumentImport.update(rec.id, {
          current_stage: 'extraction', progress_percent: 85, processed_pages: pagesCount,
          last_checkpoint: 'extraction_complete', last_heartbeat_at: nowISO(),
        } as any);
      }
    } catch {
      extracted = {};
      confFields = {};
    }

    // --- f. Merge / coût + warning > 20 pages ------------------------------
    await svc.entities.DocumentImport.update(rec.id, {
      current_stage: 'merging', progress_percent: 90,
      last_checkpoint: 'extraction_complete', last_heartbeat_at: nowISO(),
    } as any);

    const costCents = pagesCount * (COST_PER_PAGE_CENTS[engine] ?? 3);
    const warning = pagesCount > 20 ? 'Document long (> 20 pages) traité partiellement' : null;
    const conflictWarning = extractionConflicts.length
      ? `${extractionConflicts.length} conflit(s) d'extraction à valider (valeurs contradictoires entre pages)`
      : null;

    const updated = await svc.entities.DocumentImport.update(rec.id, {
      status: 'awaiting_review',
      current_stage: 'awaiting_review', progress_percent: 100,
      classification, classification_confidence: conf,
      classification_alternatives: alternatives, classification_explanation: reason,
      extracted_data: extracted, confidence_per_field: confFields,
      extraction_provenance: provenance, extraction_conflicts: extractionConflicts,
      cost_cents: costCents,
      processed_pages: pagesCount, total_pages: pagesCount,
      processing_lock_id: null, analysis_finished_at: nowISO(),
      last_checkpoint: 'awaiting_review', last_heartbeat_at: nowISO(),
      ...((warning || conflictWarning)
        ? { error_message: [warning, conflictWarning].filter(Boolean).join(' | ') }
        : {}),
    } as any);

    // --- g. Push (best-effort, post-response) ------------------------------
    waitUntil(
      sendPush(svc, user.id, `Votre ${labelFor(classification)} est prêt à valider`, 'Valider les données extraites', 'Valider', '/reglages?section=documents'),
    );

    return Response.json({
      ok: true, record: updated, classification, confidence: conf, reason,
      pages_count: pagesCount, cost_cents: costCents, engine, extraction_mode: extractionMode,
      conflicts: extractionConflicts,
    });
  } catch (error: any) {
    // Toute erreur non gérée → le document passe en failed (libère la file).
    if (docId) {
      try {
        const base44 = createClientFromRequest(req);
        await base44.asServiceRole.entities.DocumentImport.update(docId, {
          status: 'failed', error_message: error?.message || 'Erreur',
          processing_lock_id: null, analysis_finished_at: new Date().toISOString(),
        });
      } catch { /* best-effort */ }
    }
    return Response.json({ error: error?.message || 'Erreur' }, { status: 500 });
  } finally {
    // --- Avancement de la file : le document courant a quitté l'état actif,
    //     on déclenche l'orchestrateur pour démarrer le suivant. Idempotent.
    if (docId) {
      try {
        const base44 = createClientFromRequest(req);
        waitUntil(
          (async () => { try { await base44.functions.invoke('processDocumentQueue', {}); } catch {} })(),
        );
      } catch { /* best-effort */ }
    }
  }
}