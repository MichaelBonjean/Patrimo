import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { waitUntil } from 'base44:runtime';
import { decideQueue, recoverOrphan, claimPatch } from '../../shared/documentQueue.ts';

/**
 * processDocumentQueue — orchestrateur CANONIQUE de la file d'analyse
 * documentaire séquentielle.
 *
 * Payload : {} (opère sur les DocumentImport du patrimoine de l'appelant).
 *
 *  1. charge tous les DocumentImport du patrimoine (isolation RLS owner_id) ;
 *  2. récupère les locks orphelins (analyse active sans heartbeat depuis >15 min) :
 *     - avec progression → paused (erreur) pour reprise ;
 *     - sans progression  → remis en queued ;
 *  3. si un document est DÉJÀ en analyse technique active (heartbeat frais),
 *     NE démarre rien (garantit « un seul à la fois ») ;
 *  4. sinon prend le prochain document queueable (FIFO) et le claim avec un
 *     processing_lock_id unique, puis délègue le pipeline long à
 *     ingestDocument (fire-and-forget via waitUntil).
 *
 * Idempotent : plusieurs appels concurrents (deux onglets, frontend + ingestion)
 * ne démarrent jamais deux documents car (a) decideQueue bloque si un actif
 * existe et (b) ingestDocument vérifie le lock_id avant de poursuivre.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const owner = user.email;
    const svc = base44.asServiceRole;
    const now = new Date();

    const docs = await svc.entities.DocumentImport.filter({ owner_id: owner });
    const decision = decideQueue(docs, now);

    // --- Récupération des locks orphelins ---------------------------------
    for (const o of decision.orphans || []) {
      const patch = recoverOrphan(o);
      await svc.entities.DocumentImport.update(o.id, {
        ...patch,
        processing_lock_id: null,
        processing_started_at: null,
        last_heartbeat_at: now.toISOString(),
        analysis_finished_at: now.toISOString(),
      } as any);
    }

    // --- Garde-fou : un actif (fresh) ou quota épuisé → on ne démarre rien.
    if (!decision.shouldStart || !decision.next) {
      return Response.json({
        started: false,
        reason: decision.reason,
        orphans_recovered: (decision.orphans || []).length,
        active: (decision.activeFresh || []).length,
      });
    }

    // --- Claim du prochain document (FIFO) -------------------------------
    const lockId = crypto.randomUUID();
    const candidate = decision.next;
    await svc.entities.DocumentImport.update(candidate.id, claimPatch(lockId, now) as any);

    // --- Délégation au pipeline d'ingestion (long) ----------------------
    // Le verrou est déjà posé ; ingestDocument vérifiera processing_lock_id.
    // On répond immédiatement pour rester dans le budget d'exécution HTTP.
    waitUntil(
      base44.functions
        .invoke('ingestDocument', { document_import_id: candidate.id, lock_id: lockId })
        .catch(() => {
          /* Le finally de ingestDocument gère la transition de statut et
             l'avancement de la file. Échec résiduel : l'orphan recovery au
             prochain appel remettra le document en queue/paused. */
        }),
    );

    return Response.json({ started: true, id: candidate.id, lock_id: lockId });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}