import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { BellRing, Loader2, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import AlertCard from '@/components/alerts/AlertCard';
import SnoozeDialog from '@/components/alerts/SnoozeDialog';
import EmptyState from '@/components/EmptyState';
import { IlloAlertes } from '@/components/illustrations/EmptyIllustrations';
import { SOURCE_LABELS, PRIORITY_LABELS, PRIORITY_ORDER, STATUS_LABELS, priorityBadge, labelOfSource, formatDateFR } from '@/lib/alerts';

const STATUS_TABS = [
  { key: 'active', label: 'À traiter', match: (a) => a.status === 'active' || a.status === 'snoozed' },
  { key: 'resolved', label: 'Traitées', match: (a) => a.status === 'resolved' },
  { key: 'ignored', label: 'Ignorées', match: (a) => a.status === 'ignored' },
  { key: 'all', label: 'Toutes', match: () => true },
];

const PRIORITY_CHIPS = [
  { key: 'urgent', cls: 'bg-red-100 text-red-800 border-red-200' },
  { key: 'important', cls: 'bg-orange-100 text-orange-800 border-orange-200' },
  { key: 'a_traiter', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  { key: 'information', cls: 'bg-sky-100 text-sky-800 border-sky-200' },
];

export default function Alerts() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('active');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [snoozeId, setSnoozeId] = useState(null);

  const q = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const res = await base44.functions.invoke('manageAlerts', { op: 'list' });
      const data = res.data || res;
      return { alerts: data.alerts || [], counts: data.counts || {} };
    },
  });

  const mutResolveOpts = {
    mutationFn: async (id) => base44.functions.invoke('manageAlerts', { op: 'resolve', id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
    onError: (e) => toast.error('Échec : ' + (e.message || e)),
  };
  const mutIgnoreOpts = { ...mutResolveOpts, mutationFn: async (id) => base44.functions.invoke('manageAlerts', { op: 'ignore', id }) };
  const mutReactivateOpts = { ...mutResolveOpts, mutationFn: async (id) => base44.functions.invoke('manageAlerts', { op: 'reactivate', id }) };
  const mResolve = useMutation(mutResolveOpts);
  const mIgnore = useMutation(mutIgnoreOpts);
  const mReactivate = useMutation(mutReactivateOpts);
  const mSnooze = useMutation({
    mutationFn: async ({ id, days }) => base44.functions.invoke('manageAlerts', { op: 'snooze', id, days }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alerts'] }); toast.success('Alerte reportée'); },
    onError: (e) => toast.error('Échec : ' + (e.message || e)),
  });
  const mBulkResolve = useMutation({
    mutationFn: async (ids) => base44.functions.invoke('manageAlerts', { op: 'bulkResolve', ids }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['alerts'] }); toast.success(`${r.data?.n ?? r.n ?? 0} alerte(s) traitée(s)`); },
    onError: (e) => toast.error('Échec : ' + (e.message || e)),
  });

  const alerts = q.data?.alerts || [];
  const counts = q.data?.counts || {};

  const filtered = useMemo(() => {
    const tabDef = STATUS_TABS.find((t) => t.key === tab) || STATUS_TABS[0];
    return alerts
      .filter(tabDef.match)
      .filter((a) => priorityFilter === 'all' || a.priority === priorityFilter)
      .filter((a) => sourceFilter === 'all' || a.source === sourceFilter)
      .sort((a, b) => (PRIORITY_ORDER.indexOf(b.priority) - PRIORITY_ORDER.indexOf(a.priority)) || String(a.date).localeCompare(String(b.date)));
  }, [alerts, tab, priorityFilter, sourceFilter]);

  const visibleForBulk = filtered.filter((a) => a.status === 'active' || a.status === 'snoozed').map((a) => a.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><BellRing className="w-5 h-5" /> Centre d'actions & d'alertes</h1>
          <p className="text-sm text-muted-foreground">Vue unique des alertes prioritaires du patrimoine. Une seule logique de génération partagée avec le tableau de bord.</p>
        </div>
        {visibleForBulk.length > 0 && (
          <Button variant="outline" onClick={() => mBulkResolve.mutate(visibleForBulk)}><CheckCheck className="w-4 h-4 mr-1" />Tout marquer traité ({visibleForBulk.length})</Button>
        )}
      </div>

      {/* Résumé par priorité (alertes visibles) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {PRIORITY_CHIPS.map((p) => {
          const n = counts.byPriority?.[p.key] || 0;
          const active = priorityFilter === p.key;
          return (
            <button key={p.key} onClick={() => setPriorityFilter(active ? 'all' : p.key)}
              className={cn('flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition', p.cls, active && 'ring-2 ring-ring')}>
              <span className="font-medium">{PRIORITY_LABELS[p.key]}</span>
              <span className="text-lg font-bold tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      {/* Onglets statut */}
      <div className="flex items-center gap-1 border-b flex-wrap">
        {STATUS_TABS.map((t) => {
          const n = t.key === 'all' ? alerts.length : (t.key === 'active' ? counts.totalVisible : counts.byStatus?.[t.key] || 0);
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('px-3 py-2 text-sm font-medium border-b-2 -mb-px transition', tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {t.label} <span className="ml-1 text-xs text-muted-foreground">({n})</span>
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2 pb-1">
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-8 w-44 text-sm"><SelectValue placeholder="Toutes les sources" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les sources</SelectItem>
              {Object.entries(SOURCE_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="h-8 w-36 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes priorités</SelectItem>
              {PRIORITY_ORDER.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        counts.totalVisible === 0 ? (
          <EmptyState
            illustration={<IlloAlertes />}
            title="Rien à faire aujourd'hui ✨"
            subtitle="Votre patrimoine est au vert. Patrimo surveille les échéances, impayés et documents pour vous."
          />
        ) : (
          <div className="text-center py-12 text-sm text-muted-foreground">Aucune alerte pour ce filtre.</div>
        )
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((a) => (
            <AlertCard key={a.id} alert={a}
              onResolve={(id) => mResolve.mutate(id)}
              onIgnore={(id) => mIgnore.mutate(id)}
              onSnooze={(id) => setSnoozeId(id)}
              onReactivate={(id) => mReactivate.mutate(id)} />
          ))}
        </div>
      )}

      <SnoozeDialog open={!!snoozeId} onOpenChange={(o) => !o && setSnoozeId(null)}
        onConfirm={(days) => snoozeId && mSnooze.mutate({ id: snoozeId, days })} />
    </div>
  );
}