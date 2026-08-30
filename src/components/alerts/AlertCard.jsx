import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Check, EyeOff, Clock, RotateCcw, ExternalLink } from 'lucide-react';
import { PRIORITY_LABELS, STATUS_LABELS, priorityBadge, priorityStripe, priorityIcon, labelOfSource, formatDateFR } from '@/lib/alerts';

export default function AlertCard({ alert, onResolve, onIgnore, onSnooze, onReactivate, compact }) {
  const isClosed = alert.status === 'resolved' || alert.status === 'ignored';
  return (
    <div className={`rounded-lg border bg-card text-card-foreground shadow-sm border-l-4 ${priorityStripe(alert.priority)} ${isClosed ? 'opacity-60' : ''}`}>
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] px-2 py-0.5 rounded border ${priorityBadge(alert.priority)} font-semibold`}>{PRIORITY_LABELS[alert.priority] || alert.priority}</span>
              <span className="text-[11px] text-muted-foreground">{labelOfSource(alert.source)}</span>
              {alert.status === 'snoozed' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 border border-violet-200">Reportée jusqu'au {formatDateFR(alert.snooze_until)}</span>}
              {alert.status === 'resolved' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">Traitée</span>}
              {alert.status === 'ignored' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 border border-slate-300">Ignorée</span>}
            </div>
            <h3 className="text-sm font-semibold mt-1 truncate">{alert.title}</h3>
            {alert.linked_label && alert.linked_type !== 'none' && (
              <p className="text-xs text-muted-foreground truncate">{alert.linked_label}</p>
            )}
          </div>
          <span className={`text-[11px] shrink-0 ${priorityIcon(alert.priority)}`}>{formatDateFR(alert.date)}</span>
        </div>

        {!compact && alert.message && (
          <p className="text-xs text-muted-foreground leading-relaxed">{alert.message}</p>
        )}
        {!compact && alert.recommended_action && (
          <p className="text-xs"><span className="text-muted-foreground">Action : </span>{alert.recommended_action}</p>
        )}

        <div className="flex items-center gap-1 pt-1 flex-wrap">
          {alert.action_url && (
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
              <Link to={alert.action_url}>Traiter l'objet <ExternalLink className="w-3 h-3 ml-1" /></Link>
            </Button>
          )}
          {!isClosed && (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onResolve(alert.id)}><Check className="w-3 h-3 mr-1" />Marquer traitée</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onIgnore(alert.id)}><EyeOff className="w-3 h-3 mr-1" />Ignorer</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onSnooze(alert.id)}><Clock className="w-3 h-3 mr-1" />Reporter</Button>
            </>
          )}
          {isClosed && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onReactivate(alert.id)}><RotateCcw className="w-3 h-3 mr-1" />Rouvrir</Button>
          )}
        </div>
      </div>
    </div>
  );
}