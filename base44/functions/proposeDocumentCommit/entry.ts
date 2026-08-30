import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { buildCommitPlan } from '../../shared/documentCommit.ts';

/**
 * proposeDocumentCommit — regarde un DocumentImport déjà ingéré (status
 * 'awaiting_review') et calcule, côté serveur, le plan de commit
 * (matching + normalisation + confiance) à présenter à l'utilisateur pour
 * validation.
 *
 * Payload : { document_import_id }
 * Retourne : { ok, record, plan: { targets, document_meta, needs_review, risk_notes } }
 *
 *  - isolation multi-tenant (RLS owner_id + lecture explicite)
 *  - le contexte (properties/lots/leases/holders) est chargé via asServiceRole
 *    filtré par owner_id (le moteur documentCommit est pur et ne lit rien)
 *  - ne crée ni ne modifie aucune entité : c'est une projection du plan
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

    const [properties, lots, leases, holders] = await Promise.all([
      svc.entities.Property.filter({ owner_id: user.email }).catch(() => []),
      svc.entities.Lot.filter({ owner_id: user.email }).catch(() => []),
      svc.entities.Lease.filter({ owner_id: user.email }).catch(() => []),
      svc.entities.Holder.filter({ owner_id: user.email }).catch(() => []),
    ]);

    const plan = buildCommitPlan({
      classification: rec.classification || 'unknown',
      extracted_data: rec.extracted_data || {},
      confidence_per_field: rec.confidence_per_field || {},
      classification_confidence: rec.classification_confidence || 0,
      context: { properties: properties || [], lots: lots || [], leases: leases || [], holders: holders || [] },
    });

    return Response.json({ ok: true, record: rec, plan });
  } catch (error) {
    return Response.json({ error: (error as any)?.message || 'erreur' }, { status: 500 });
  }
}