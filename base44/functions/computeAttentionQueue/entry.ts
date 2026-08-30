import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import {
  evaluateBankTransaction, evaluateDocumentImport, evaluateImpaye,
  evaluateAlert, evaluateRentRevision, evaluateMonthClose, buildAttentionQueue,
} from '../../shared/exceptionEngine.ts';
import { buildCommitPlan } from '../../shared/documentCommit.ts';

/**
 * computeAttentionQueue — applique la logique « Exception Only » à l'ensemble
 * du portefeuille du propriétaire et ne renvoie QUE les éléments qui nécessitent
 * une intervention (NEEDS_CONFIRMATION, NEEDS_ACTION, ERROR).
 *
 *   Payload : {}
 *   Retourne : { ok, items, count, by_domain, by_level, auto_count }
 *
 *  - isolation multi-tenant (RLS owner_id + lecture explicite par owner_id)
 *  - les verdicts AUTO_PROCESS sont comptés (auto_count) mais jamais renvoyés
 *    dans `items` — l'UI ne présente que les exceptions
 *  - pour les DocumentImport en 'awaiting_review', le plan de commit est
 *    reconstitué (buildCommitPlan) afin de décider AUTO vs NEEDS_CONFIRMATION
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const owner = user.email;
    const svc = base44.asServiceRole;

    const [bankTx, docs, impayes, alerts, revisions, monthCloses, properties, lots, leases, holders] = await Promise.all([
      svc.entities.BankTransaction.filter({ owner_id: owner }).catch(() => []),
      svc.entities.DocumentImport.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Impaye.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Alert.filter({ owner_id: owner }).catch(() => []),
      svc.entities.RentRevision.filter({ owner_id: owner }).catch(() => []),
      svc.entities.MonthClose.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Property.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Lot.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Lease.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Holder.filter({ owner_id: owner }).catch(() => []),
    ]);

    const verdicts: any[] = [];
    for (const tx of bankTx || []) verdicts.push(evaluateBankTransaction(tx));
    for (const imp of impayes || []) verdicts.push(evaluateImpaye(imp));
    for (const a of alerts || []) verdicts.push(evaluateAlert(a));
    for (const r of revisions || []) verdicts.push(evaluateRentRevision(r));
    for (const mc of monthCloses || []) verdicts.push(evaluateMonthClose(mc));
    for (const d of docs || []) {
      let plan: any = null;
      if (d.status === 'awaiting_review') {
        plan = buildCommitPlan({
          classification: d.classification || 'unknown',
          extracted_data: d.extracted_data || {},
          confidence_per_field: d.confidence_per_field || {},
          classification_confidence: d.classification_confidence || 0,
          context: { properties: properties || [], lots: lots || [], leases: leases || [], holders: holders || [] },
        });
      }
      verdicts.push(evaluateDocumentImport(d, plan));
    }

    const queue = buildAttentionQueue(verdicts);
    return Response.json({ ok: true, ...queue });
  } catch (error) {
    return Response.json({ error: (error as any)?.message || 'erreur' }, { status: 500 });
  }
}