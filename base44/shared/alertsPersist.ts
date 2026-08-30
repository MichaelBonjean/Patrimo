import { generateAlerts } from './alertsEngine.ts';

/**
 * alertsPersist — actualise les alertes d'un propriétaire : charge toutes les
 * données (incl. les structures/SCI), génère les drafts via alertsEngine, les
 * dédoublonne par empreinte stable et les persiste (création / mise à jour /
 * résolution des alertes dont la source a disparu).
 *
 * Source unique de vérité partagée par :
 *  - `manageAlerts` (op 'list', déclenché à la visite du Dashboard / page
 *    Alertes) ;
 *  - le job cron `upcoming_alerts` (runBackgroundJobs, workflow « Travaux de
 *    fond Patrimo » quotidien) — garantit des alertes fraîches même sans visite,
 *    afin de ne rater aucun encaissement.
 */
export async function refreshAlerts(svc: any, owner: string, now: Date = new Date()) {
  const [
    properties, lots, leases, impayes, payments, bankTransactions,
    documents, rentRevisions, rentDues, transactions, holders,
  ] = await Promise.all([
    svc.entities.Property.filter({ owner_id: owner }).catch(() => []),
    svc.entities.Lot.filter({ owner_id: owner }).catch(() => []),
    svc.entities.Lease.filter({ owner_id: owner }).catch(() => []),
    svc.entities.Impaye.filter({ owner_id: owner }).catch(() => []),
    svc.entities.Payment.filter({ owner_id: owner }).catch(() => []),
    svc.entities.BankTransaction.filter({ owner_id: owner }).catch(() => []),
    svc.entities.Document.filter({ owner_id: owner }).catch(() => []),
    svc.entities.RentRevision.filter({ owner_id: owner }).catch(() => []),
    svc.entities.RentDue.filter({ owner_id: owner }).catch(() => []),
    svc.entities.Transaction.filter({ owner_id: owner }).catch(() => []),
    svc.entities.Holder.filter({ owner_id: owner }).catch(() => []),
  ]);

  const drafts = generateAlerts({
    properties, lots, leases, impayes, payments, bankTransactions,
    documents, rentRevisions, rentDues, transactions, holders,
  }, now);

  const existing = await svc.entities.Alert.filter({ owner_id: owner }).catch(() => []);
  const byFp = new Map<string, any>();
  for (const e of existing || []) if (e.fingerprint) byFp.set(e.fingerprint, e);
  const draftFps = new Set(drafts.map((d) => d.fingerprint));
  const todayISO = now.toISOString().slice(0, 10);

  for (const d of drafts) {
    const ex = byFp.get(d.fingerprint);
    if (ex && (ex.status === 'resolved' || ex.status === 'ignored')) continue;
    if (ex) {
      let status = ex.status;
      // réactivation automatique si le report est échéancé
      if (status === 'snoozed' && (!ex.snooze_until || ex.snooze_until < todayISO)) status = 'active';
      const changed = ex.title !== d.title || ex.message !== d.message || ex.date !== d.date ||
        ex.linked_label !== d.linked_label || ex.priority !== d.priority || ex.status !== status;
      if (changed) {
        const updated = await svc.entities.Alert.update(ex.id, {
          title: d.title, message: d.message, date: d.date, linked_label: d.linked_label,
          priority: d.priority as any, recommended_action: d.recommended_action, action_url: d.action_url,
          status: status as any, snooze_until: status === 'snoozed' ? ex.snooze_until : null,
        });
        byFp.set(d.fingerprint, updated);
      }
      continue;
    }
    const created = await svc.entities.Alert.create({
      owner_id: owner, is_demo: false,
      source: d.source, linked_type: d.linked_type, linked_id: d.linked_id,
      linked_label: d.linked_label, title: d.title, message: d.message, date: d.date,
      priority: d.priority, status: 'active', recommended_action: d.recommended_action,
      action_url: d.action_url, fingerprint: d.fingerprint, actor: owner,
    });
    byFp.set(d.fingerprint, created);
  }

  // Marque 'resolved' les alertes actives dont la source a disparu (impayé
  // régularisé, document supprimé…). On ne touche pas aux 'snoozed/ignored'.
  for (const e of existing || []) {
    if (e.status !== 'active') continue;
    if (draftFps.has(e.fingerprint)) continue;
    const updated = await svc.entities.Alert.update(e.id, { status: 'resolved', resolved_date: todayISO, actor: owner });
    byFp.set(e.fingerprint, updated);
  }

  const all = Array.from(byFp.values());
  return { alerts: all, counts: computeCounts(all) };
}

export function computeCounts(alerts: any[]) {
  const visible = alerts.filter((a) => a.status === 'active' || a.status === 'snoozed');
  const byPriority: Record<string, number> = { urgent: 0, important: 0, a_traiter: 0, information: 0 };
  const byStatus: Record<string, number> = { active: 0, snoozed: 0, resolved: 0, ignored: 0 };
  const bySource: Record<string, number> = {};
  for (const a of alerts) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  for (const a of visible) {
    byPriority[a.priority] = (byPriority[a.priority] || 0) + 1;
    bySource[a.source] = (bySource[a.source] || 0) + 1;
  }
  return {
    totalVisible: visible.length,
    byPriority,
    byStatus,
    bySource,
    urgent: byPriority.urgent,
  };
}