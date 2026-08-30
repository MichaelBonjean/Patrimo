import React from 'react';
import { cn } from '@/lib/utils';
import { colorForDomain } from '@/lib/iconColors';
import { ChevronRight } from 'lucide-react';

const TONE = {
  default: '',
  positive: 'border-emerald-200',
  negative: 'border-rose-200',
  warning: 'border-amber-200',
  primary: 'border-primary/30',
};

export default function KpiCard({ label, value, sub, icon: Icon, tone = 'default', domain = 'biens', onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={onClick ? 'Voir le détail' : undefined}
      className={cn(
        'text-left bg-card rounded-xl border border-border p-4 relative hover:shadow-md transition-shadow',
        onClick ? 'cursor-pointer' : 'cursor-default',
        TONE[tone]
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">{label}</p>
          <p className="text-xl font-bold number-fr mt-1">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
        </div>
        {Icon && (
          <div className="p-2 rounded-lg bg-muted shrink-0">
            <Icon className={cn('w-4 h-4', colorForDomain(domain))} />
          </div>
        )}
      </div>
      {onClick && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60 absolute bottom-3 right-3" />}
    </button>
  );
}