import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * rejectDocumentImport — marque un import IA comme rejeté par l'utilisateur.
 *
 * Payload : { document_import_id, reason? }
 *
 * Le document (fichier + ocr_text + extracted_data) est conservé pour audit
 * RGPD pendant 30 jours, puis purgé par le workflow « Purger documents anciens »
 * (status 'rejected' > 30 j → suppression du record).
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const id = body?.document_import_id;
    if (!id) return Response.json({ error: 'document_import_id requis' }, { status: 400 });

    const svc = base44.asServiceRole;
    const mine = await svc.entities.DocumentImport.filter({ owner_id: user.email });
    const rec = (mine || []).find((r: any) => r.id === id);
    if (!rec) return Response.json({ error: 'Document introuvable' }, { status: 404 });
    if (rec.status === 'committed') return Response.json({ error: 'Document déjà validé, non rejetable' }, { status: 409 });

    const reason = (body?.reason || 'Rejeté par l\'utilisateur').slice(0, 500);
    const updated = await svc.entities.DocumentImport.update(rec.id, {
      status: 'rejected',
      error_message: reason,
    });

    return Response.json({ ok: true, record: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}