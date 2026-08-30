import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  AlertTriangle, CheckCircle2, ChevronRight, CircleAlert,
  FileWarning, Bell, CalendarClock, Wallet,
} from 'lucide-react';
import { Card } from '@/components/ui/card';

const DOMAIN_META = {
  payment: { icon: Wallet, label: 'Banque' },
  document: { icon: FileWarning, label: 'Document' },
  impaye: { icon: AlertTriangle, label: 'Impayé' },
  alert: { icon: Bell, label: 'Alerte' },
  rentRevision: { icon: CircleAlert, label: 'Indexation' },
  monthClose: { icon: CalendarClock, label: 'Clôture' },
};

const LEVEL_META = {
  ERROR: { label: 'Erreur', tone: 'text-destructive' },
  NEEDS_ACTION: { label: 'Action requise', tone: 'text-amber-600' },
  NEEDS_CONFIRMATION: { label: 'À confirmer', tone: 'text-blue-600' },
};

export default function AttentionQueueWidget() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['attention-queue'],
    queryFn: () => base44.functions.invoke('computeAttentionQueue', {}),
    staleTime: 60_000,
  });

  if (isLoading) return null;

  // base44.functions.invoke renvoie la réponse Axios : le JSON est dans `data`.
  const queue = data?.data || data || {};
  const items = queue.items || [];
  const count = queue.count || 0;
  const autoCount = queue.auto_count || 0;

  if (count === 0) {
    return (
      <Card className="p-5 flex items-center gap-3 bg-emerald-50/60 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">Tout est à jour</div>
          <div className="text-sm text-muted-foreground">
            Aucune action requise{autoCount > 0 ? ` — ${autoCount} opération(s) traitée(s) automatiquement.` : '.'}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 flex items-center justify-center font-bold text-lg shrink-0">
          {count}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-base">éléments nécessitent votre attention</div>
          <div className="text-sm text-muted-foreground">
            Patrimo a traité le reste automatiquement{autoCount > 0 ? ` (${autoCount} opération(s))` : ''}.
          </div>
        </div>
      </div>

      <div className="space-y-1">
        {items.slice(0, 8).map((v, i) => {
          const meta = DOMAIN_META[v.domain] || DOMAIN_META.alert;
          const Icon = meta.icon;
          const lvl = LEVEL_META[v.level] || LEVEL_META.NEEDS_ACTION;
          const clickable = !!v.action_url;
          return (
            <button
              key={i}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && navigate(v.action_url)}
              className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 disabled:hover:bg-transparent text-left transition-colors"
            >
              <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{v.reason || v.linked_label || meta.label}</div>
                <div className={`text-xs ${lvl.tone}`}>{lvl.label} · {meta.label}</div>
              </div>
              {clickable && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
            </button>
          );
        })}
        {items.length > 8 && (
          <div className="text-xs text-muted-foreground pt-1 px-2">+ {items.length - 8} autre(s)</div>
        )}
        <button
          type="button"
          onClick={() => navigate('/a-faire')}
          className="w-full mt-2 pt-2 border-t border-border/60 text-sm text-primary font-medium hover:underline text-left"
        >
          Tout voir →
        </button>
      </div>
    </Card>
  );
}