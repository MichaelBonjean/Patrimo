import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { isLeaseActiveAt, todayISO } from '../../shared/leaseResolve.ts';
import { generateRentDuesForLease } from '../../shared/rentDueEngine.ts';
import { syncImpayesAll } from '../../shared/impayeEngine.ts';
import { refreshAlerts } from '../../shared/alertsPersist.ts';

/**
 * runBackgroundJobs — exécute les automatisations de fond de Patrimo entre
 * deux connexions. Chaque job est :
 *   - isolé par patrimony_id (owner_id) ;
 *   - journalisé dans JobRun (clé d'idempotence owner|job|as_of) ;
 *   - idempotent : un même jour re-déclenché trouve le run succès et skip ;
 *   - relançable sans corruption (les skip/placeholders ne touchent pas les
 *     données métier).
 *
 * Jobs ACTIFS (sûrs, idempotents) :
 *   - rent_dues        : génère les échéances des baux actifs (m+1).
 *   - impayes          : synchronise les impayés sur le compte locataire.
 *   - expiring_documents : crée des Alertes pour docs expirant à 30 j.
 *   - available_revision : crée une proposition RentRevision si révision due.
 *   - upcoming_alerts  : actualise les alertes (échéances loyers à venir, dates clés SCI).
 *
 * Jobs JOURNALISÉS en SKIPPED (attente de dépendance externe) :
 *   - bank_sync, reconciliation, crd_evolution, document_classification,
 *     anomaly_detection.
 *
 * Modes :
 *   - Cron (aucun user) : itère tous les propriétaires présents.
 *   - Admin authentifié : limite à son patrimoine sauf body.all_owners=true.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') {
      return Response.json(
        { error: 'Forbidden : réservé au système planifié ou admin' },
        { status: 403 },
      );
    }
    const svc = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch (_e) { /* payload vide */ }

    const asOf = todayISO();
    const actor = user?.email || 'cron';

    // Détermine la liste des propriétaires à traiter.
    let owners: string[] = [];
    if (user && !body.all_owners) {
      owners = [user.email];
    } else if (body.owner_id) {
      owners = [String(body.owner_id)];
    } else {
      // Cron : tous les propriétaires ayant au moins un bail (réduit le scan).
      const leases = await svc.entities.Lease.list(500).catch(() => []);
      const props = await svc.entities.Property.list(500).catch(() => []);
      const set = new Set<string>();
      for (const l of leases || []) if (l.owner_id) set.add(l.owner_id);
      for (const p of props || []) if (p.owner_id) set.add(p.owner_id);
      owners = [...set];
    }

    const results: any[] = [];
    for (const owner of owners) {
      try {
        const r = await runForOwner(svc, owner, asOf, actor);
        results.push({ owner, ...r });
      } catch (e) {
        results.push({ owner, error: (e as any)?.message || 'erreur' });
      }
    }

    return Response.json({ ok: true, as_of: asOf, owners: owners.length, results });
  } catch (error) {
    return Response.json({ error: (error as any)?.message || 'erreur' }, { status: 500 });
  }
}

const JOBS = [
  'rent_dues', 'impayes', 'expiring_documents', 'available_revision', 'upcoming_alerts',
  'bank_sync', 'reconciliation', 'crd_evolution', 'document_classification', 'anomaly_detection',
];

async function runForOwner(svc: any, owner: string, asOf: string, actor: string) {
  const summary: Record<string, any> = {};
  for (const job of JOBS) {
    const key = `${owner}|${job}|${asOf}`;
    // Idempotence : un run succès existe déjà aujourd'hui → on skip.
    const existing = await svc.entities.JobRun.filter({ idempotency_key: key }).catch(() => []);
    const prev = (existing || [])[0];
    if (prev && prev.status === 'success') {
      summary[job] = { status: 'skipped', skip_reason: 'already_success_today', counts: prev.counts || {} };
      continue;
    }
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    let run: any;
    try {
      run = await svc.entities.JobRun.create({
        owner_id: owner, patrimony_id: owner, job, idempotency_key: key,
        status: 'running', as_of: asOf, started_at: startedAt, actor,
      });
    } catch (_e) {
      // RLS service-role bypass : si la création échoue quand même, on continue
      // sans journalisation plutôt que de bloquer le job métier.
      run = { id: null };
    }

    let counts: any = {};
    let status = 'success';
    let skipReason: string | null = null;
    let errorMessage: string | null = null;
    try {
      const out = await executeJob(svc, job, owner, asOf);
      counts = out.counts || {};
      status = out.status;
      skipReason = out.skip_reason || null;
      if (out.error) {
        status = 'error';
        errorMessage = out.error;
      }
    } catch (e) {
      status = 'error';
      errorMessage = (e as any)?.message || 'erreur';
    }

    const finishedAt = new Date().toISOString();
    if (run?.id) {
      await svc.entities.JobRun.update(run.id, {
        status, finished_at: finishedAt, duration_ms: Date.now() - t0,
        counts, skip_reason: skipReason, error_message: errorMessage,
      }).catch(() => null);
    }
    summary[job] = { status, counts, skip_reason: skipReason, error: errorMessage };
  }
  return { jobs: summary };
}

async function executeJob(svc: any, job: string, owner: string, asOf: string): Promise<any> {
  switch (job) {
    case 'rent_dues': {
      const leases = await svc.entities.Lease.filter({ owner_id: owner }).catch(() => []);
      let created = 0, skipped = 0;
      for (const l of leases || []) {
        if (!isLeaseActiveAt(l, asOf)) continue;
        const r = await generateRentDuesForLease(svc, l, { today: asOf, forward_months: 1, backfill_months: 0 });
        created += r.created || 0;
        skipped += r.skipped || 0;
      }
      return { status: 'success', counts: { created, skipped, leases: (leases || []).length } };
    }
    case 'impayes': {
      const r = await syncImpayesAll(svc, asOf, owner);
      return { status: 'success', counts: { created: r.created || 0, updated: r.updated || 0, scanned: r.scanned || 0 } };
    }
    case 'expiring_documents': {
      const docs = await svc.entities.Document.filter({ owner_id: owner }).catch(() => []);
      const today = new Date(asOf + 'T00:00:00Z').getTime();
      const horizon = today + 30 * 86400000;
      const typeToSource: Record<string, string> = {
        assurance: 'assurance', dpe: 'dpe', bail: 'bail_expirant',
      };
      let created = 0, skipped = 0;
      for (const d of docs || []) {
        if (!d.expiration_date) continue;
        const exp = new Date(String(d.expiration_date).slice(0, 10) + 'T00:00:00Z').getTime();
        if (isNaN(exp) || exp < today || exp > horizon) continue;
        const source = typeToSource[d.type] || null;
        if (!source) continue;
        const fingerprint = `expiring|${d.id}|${d.expiration_date}`;
        const dup = await svc.entities.Alert.filter({ owner_id: owner, fingerprint }).catch(() => []);
        if ((dup || []).length) { skipped += 1; continue; }
        const priority = source === 'bail_expirant' ? 'a_traiter' : 'important';
        await svc.entities.Alert.create({
          owner_id: owner, is_demo: !!d.is_demo,
          source, linked_type: 'document', linked_id: d.id, linked_label: d.title || d.filename || 'Document',
          title: `Document expirant : ${d.title || d.filename || ''}`,
          message: `Le document « ${d.title || d.filename || ''} » expire le ${d.expiration_date}.`,
          date: asOf, priority, status: 'active',
          recommended_action: 'Anticiper le renouvellement.',
          action_url: '/reglages?section=documents',
          fingerprint, actor: 'cron',
        });
        created += 1;
      }
      return { status: 'success', counts: { alerts_created: created, skipped, scanned: (docs || []).length } };
    }
    case 'available_revision': {
      const leases = await svc.entities.Lease.filter({ owner_id: owner }).catch(() => []);
      let created = 0, skipped = 0;
      for (const l of leases || []) {
        if (!isLeaseActiveAt(l, asOf)) continue;
        if (!l.indexation_type || l.indexation_type === 'aucune') continue;
        if (!l.next_revision_date) continue;
        const next = new Date(String(l.next_revision_date).slice(0, 10) + 'T00:00:00Z').getTime();
        if (isNaN(next) || next > new Date(asOf + 'T00:00:00Z').getTime()) continue;
        // Idempotence : une proposition ouverte existe déjà pour ce bail.
        const existing = await svc.entities.RentRevision.filter({ owner_id: owner, lease_id: l.id, status: 'proposition' }).catch(() => []);
        if ((existing || []).length) { skipped += 1; continue; }
        await svc.entities.RentRevision.create({
          owner_id: owner, is_demo: !!l.is_demo,
          lease_id: l.id, lot_id: l.lot_id, property_id: l.property_id,
          indexation_type: l.indexation_type,
          reference_quarter: l.index_reference || '',
          old_rent: l.rent_excluding_charges || 0,
          old_index_value: l.index_value_initial || 0,
          new_index_value: l.index_value_current || 0,
          new_rent: 0, variation_amount: 0, variation_percent: 0,
          formula: 'Révision disponible — à calculer',
          new_revision_date: l.next_revision_date,
          blocked_reason: 'Indice courant non renseigné — à valider',
          can_apply: false,
          status: 'proposition',
        });
        created += 1;
      }
      return { status: 'success', counts: { revisions_created: created, skipped, leases: (leases || []).length } };
    }
    case 'upcoming_alerts': {
      const { alerts, counts } = await refreshAlerts(svc, owner, new Date(asOf + 'T00:00:00'));
      return { status: 'success', counts: { alerts: alerts.length, active: counts.totalVisible, urgent: counts.urgent } };
    }
    // Jobs non actifs : journalisés en skip (attente dépendance externe).
    // Ne touchent aucune donnée métier → relançables sans corruption.
    case 'bank_sync':
      return { status: 'skipped', skip_reason: 'no_bank_connector_authorized', counts: {} };
    case 'reconciliation':
      return { status: 'skipped', skip_reason: 'manual_confirmation_required_for_safety', counts: {} };
    case 'crd_evolution':
      return { status: 'skipped', skip_reason: 'loan_schedule_snapshot_not_enabled', counts: {} };
    case 'document_classification':
      return { status: 'skipped', skip_reason: 'classification_runs_at_ingest', counts: {} };
    case 'anomaly_detection':
      return { status: 'skipped', skip_reason: 'covered_by_impayes_job', counts: {} };
    default:
      return { status: 'skipped', skip_reason: 'unknown_job', counts: {} };
  }
}