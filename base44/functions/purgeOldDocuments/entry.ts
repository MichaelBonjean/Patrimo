import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * purgeOldDocuments — politique de rétention RGPD des imports IA.
 *
 *  - Fichier original : supprimé (file_url effacée) après 90 jours.
 *    ocr_text + extracted_data conservés indéfiniment (utilité historique).
 *  - Imports rejetés : record entier purgé après 30 jours (audit RGPD écoulé).
 *
 * Réservé au système planifié (sans user) ou à un admin. Workflow quotidien 3h.
 */
const DAY_MS = 86400000;

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: reserved to scheduled system or admin' }, { status: 403 });
    }
    const svc = base44.asServiceRole;

    const now = Date.now();
    const d90 = now - 90 * DAY_MS;
    const d30 = now - 30 * DAY_MS;

    const all: any[] = await svc.entities.DocumentImport.list('-created_date', 500);
    let purgedFiles = 0;
    let purgedRejected = 0;
    let hasMore = false;

    for (const r of all || []) {
      if (!r.created_date) continue;
      const t = new Date(r.created_date).getTime();
      if (Number.isNaN(t)) continue;

      // Rejets > 30 j → purge du record entier
      if (r.status === 'rejected' && t < d30) {
        await svc.entities.DocumentImport.delete(r.id);
        purgedRejected++;
        continue;
      }
      // Fichier original > 90 j → on efface la référence (ocr_text conservé)
      if (r.file_url && t < d90) {
        await svc.entities.DocumentImport.update(r.id, { file_url: null });
        purgedFiles++;
      }
    }
    hasMore = (all || []).length >= 500;

    return Response.json({ ok: true, purged_files: purgedFiles, purged_rejected: purgedRejected, hasMore });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}