import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/**
 * getVisitSummary — calcule le résumé "Depuis votre dernière visite, Patrimo a :"
 * à partir des JobRun success et des entités créées depuis last_visit_seen_at
 * (stocké sur user.data via auth.updateMe).
 *
 *   Payload : {}
 *   Retourne : { ok, since, lines: [{key,label,count}], to_verify, to_verify_url }
 *
 * Effet de bord : met à jour user.data.last_visit_seen_at = now (pour la
 * prochaine visite). Un appel = une "visite" marquée.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const owner = user.email;
    const svc = base44.asServiceRole;

    const lastSeen = (user as any).data?.last_visit_seen_at;
    const now = new Date();
    const since = lastSeen ? new Date(lastSeen) : new Date(now.getTime() - 7 * 86400000);

    const [jobs, quittances, alerts, docs, bankTx, impayes] = await Promise.all([
      svc.entities.JobRun.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Quittance.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Alert.filter({ owner_id: owner }).catch(() => []),
      svc.entities.DocumentImport.filter({ owner_id: owner }).catch(() => []),
      svc.entities.BankTransaction.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Impaye.filter({ owner_id: owner }).catch(() => []),
    ]);

    const sinceMs = since.getTime();
    const jobSince = (jobs || []).filter((j: any) => j.status === 'success' && new Date(j.started_at || j.created_date).getTime() >= sinceMs);

    const sumCounts = (key: string, field: string): number => {
      let s = 0;
      for (const j of jobSince) {
        if (j.job === key) s += Number((j.counts as any)?.[field] || 0);
      }
      return s;
    };

    const createdSince = (arr: any[], dateField = 'created_date'): number =>
      (arr || []).filter((x: any) => {
        const d = x[dateField] ? new Date(x[dateField]).getTime() : 0;
        return d >= sinceMs;
      }).length;

    const loyers = sumCounts('rent_dues', 'created');
    const creditsUpdated = sumCounts('crd_evolution', 'updated'); // 0 tant que job inactif
    const quittancesPrepared = createdSince(quittances) || sumCounts('rent_dues', 'created') - 0;
    const alertsCreated = createdSince(alerts);
    const impayesDetected = createdSince(impayes) || sumCounts('impayes', 'created');
    const docsClassified = createdSince(docs, 'created_date'); // best-effort

    // Éléments à vérifier (exceptions courantes, snapshot).
    const toVerify =
      (alerts || []).filter((a: any) => a.status === 'active' && (a.priority === 'important' || a.priority === 'urgent')).length +
      (docs || []).filter((d: any) => d.status === 'awaiting_review').length +
      (bankTx || []).filter((t: any) => t.status === 'pending').length +
      (impayes || []).filter((i: any) => i.status && i.status !== 'régularisé' && i.status !== 'r\u00e9gularis\u00e9' && i.status !== 'abandonn\u00e9').length;

    const lines = [
      { key: 'rents', label: 'reconnu', count: loyers },
      { key: 'credits', label: 'mis à jour vos crédits', count: creditsUpdated },
      { key: 'quittances', label: 'préparé des quittances', count: quittancesPrepared },
      { key: 'alerts', label: 'levé des alertes', count: alertsCreated },
      { key: 'impayes', label: 'détecté des impayés', count: impayesDetected },
      { key: 'docs', label: 'classé des documents', count: docsClassified },
    ].filter((l) => l.count > 0);

    // Marque la visite comme vue (prochaine visite repartira de maintenant).
    await base44.auth.updateMe({ last_visit_seen_at: now.toISOString() }).catch(() => null);

    return Response.json({
      ok: true,
      since: since.toISOString(),
      lines,
      to_verify: toVerify,
      to_verify_url: toVerify > 0 ? '/a-faire' : null,
    });
  } catch (error) {
    return Response.json({ error: (error as any)?.message || 'erreur' }, { status: 500 });
  }
}