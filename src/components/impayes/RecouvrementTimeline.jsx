import React from 'react';
import { ACTOR_LABELS, METHOD_LABELS, fmtDate } from '@/lib/recouvrementTemplates';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Clock } from 'lucide-react';

const ACTOR_STYLES = {
  bailleur: 'bg-primary/10 text-primary border-primary/30',
  professionnel: 'bg-purple-100 text-purple-700 border-purple-300',
  systeme: 'bg-slate-100 text-slate-600 border-slate-200',
};

/** Fusionne action_history (canonique) + relance_history (legacy) en une liste triée. */
export function mergeHistory(impaye) {
  const ah = (impaye.action_history || []).map((a) => ({
    date: a.date, stage: a.stage, label: a.label || a.stage, actor: a.actor || 'bailleur',
    method: a.method, note: a.note, document_url: a.document_url, amount: a.amount,
  }));
  const rh = (impaye.relance_history || []).map((r) => ({
    date: r.date, stage: r.type, label: r.type || 'relance', actor: r.method === 'courrier_lrar' ? 'bailleur' : 'bailleur',
    method: r.method, note: r.note, document_url: null, amount: null, _legacy: true,
  }));
  return [...ah, ...rh].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export default function RecouvrementTimeline({ impaye }) {
  const items = mergeHistory(impaye);
  if (!items.length) {
    return <p className="text-sm text-muted-foreground py-3">Aucune action enregistrée pour cette dette locative.</p>;
  }
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
      {items.map((h, i) => (
        <div key={i} className="text-sm border-l-2 border-primary/40 pl-3 py-1">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-medium">{h.label}</span>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {fmtDate(h.date)}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <Badge variant="outline" className={cn('text-[10px]', ACTOR_STYLES[h.actor] || ACTOR_STYLES.bailleur)}>
              {ACTOR_LABELS[h.actor] || h.actor}
            </Badge>
            {h.method && (
              <span className="text-xs text-muted-foreground">{METHOD_LABELS[h.method] || h.method}</span>
            )}
            {h.amount != null && Number.isFinite(h.amount) && (
              <span className="text-xs font-medium">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(h.amount)}</span>
            )}
          </div>
          {h.note && <p className="text-xs text-muted-foreground mt-0.5">{h.note}</p>}
        </div>
      ))}
    </div>
  );
}