import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Check, ArrowUpRight } from 'lucide-react';

export default function StepCard({ index, title, description, icon: Icon, to, metrics = [], done }) {
  return (
    <div className={cn('relative rounded-xl border p-4 transition-colors', done ? 'border-emerald-200 bg-emerald-50/40' : 'border-border bg-card')}>
      <div className="flex items-start gap-3">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold', done ? 'bg-emerald-100 text-emerald-700' : 'bg-primary/10 text-primary')}>
          {done ? <Check className="w-4 h-4" /> : index}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
            <h3 className="text-sm font-semibold">{title}</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          {metrics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {metrics.map((m, i) => (
                <span key={i} className={cn(
                  'text-xs px-2 py-0.5 rounded-md border number-fr',
                  m.tone === 'positive' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : m.tone === 'negative' ? 'border-rose-200 bg-rose-50 text-rose-700'
                    : m.tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-border bg-muted text-muted-foreground'
                )}>{m.label} : <b>{m.value}</b></span>
              ))}
            </div>
          )}
        </div>
        {to && (
          <Link to={to} className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline self-center">
            Ouvrir<ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}