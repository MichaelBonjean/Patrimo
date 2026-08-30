import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { useOwnerFilter } from '@/lib/tenantFilter';

const JOB_LABELS = {
  rent_dues: 'échéances de loyer',
  impayes: 'impayés',
  expiring_documents: 'documents expirants',
  available_revision: 'révisions de loyer',
  bank_sync: 'synchronisation bancaire',
  reconciliation: 'rapprochement bancaire',
  crd_evolution: 'capital restant dû',
  document_classification: 'classification de documents',
  anomaly_detection: 'détection d\'anomalies',
};

function secs(s) {
  const d = new Date(s).getTime();
  return Number.isFinite(d) ? d : 0;
}

export default function BackgroundJobsChip() {
  const { withOwner } = useOwnerFilter();
  const [open, setOpen] = useState(false);
  const [hideRecent, setHideRecent] = useState(false);

  const { data: runs = [] } = useQuery({
    queryKey: ['jobruns-recent'],
    queryFn: () => base44.entities.JobRun.filter(withOwner(), '-created_date', 5),
    refetchInterval: 5000,
    staleTime: 3000,
  });

  const running = runs.filter((r) => r.status === 'running');
  const recent = runs
    .filter((r) => r.status === 'success' && r.finished_at && (Date.now() - secs(r.finished_at)) < 60_000)
    .sort((a, b) => secs(b.finished_at) - secs(a.finished_at))[0];

  useEffect(() => {
    if (!recent) return;
    setHideRecent(false);
    const t = setTimeout(() => setHideRecent(true), 5000);
    return () => clearTimeout(t);
  }, [recent?.id]);

  if (running.length > 0) {
    const r = running[0];
    const label = JOB_LABELS[r.job] || r.job || 'traitement…';
    const cnt = r.counts || {};
    const n = cnt.total || cnt.created || cnt.alerts_created || '';
    return (
      <>
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-card border border-border shadow-sm text-xs text-muted-foreground hover:bg-muted transition-colors">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
          <span className="truncate max-w-[260px]">🤖 En arrière-plan : {label}{n ? ` (${n})` : ''}…</span>
        </button>
        {open && (
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        )}
        {open && (
          <div className="absolute z-50 mt-2 right-0 w-72 rounded-xl border border-border bg-card shadow-lg p-3 text-xs space-y-2">
            <p className="font-medium text-foreground">Jobs en cours</p>
            {running.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                <span className="truncate">{JOB_LABELS[r.job] || r.job}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  if (recent && !hideRecent) {
    const label = JOB_LABELS[recent.job] || recent.job || 'traitement';
    const cnt = recent.counts || {};
    const n = cnt.total || cnt.created || cnt.alerts_created || cnt.reconciled || '';
    return (
      <>
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300 text-xs hover:bg-emerald-100 transition-colors">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span className="truncate max-w-[280px]">✨ {n ? `${n} ` : ''}{label}{n ? ' traité' : ' terminé'}{n && n > 1 ? 's' : ''} automatiquement</span>
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute z-50 mt-2 right-0 w-72 rounded-xl border border-border bg-card shadow-lg p-3 text-xs">
              <p className="font-medium text-emerald-700 dark:text-emerald-300">Terminé : {label}</p>
              <p className="text-muted-foreground mt-1">{n ? `${n} opération(s) · ` : ''}{recent.duration_ms ? `${Math.round(recent.duration_ms / 1000)} s` : ''}</p>
            </div>
          </>
        )}
      </>
    );
  }

  return null;
}