import React from 'react';
import { STAGES, stageOf, END_STAGES } from '@/lib/recouvrementTemplates';
import { cn } from '@/lib/utils';
import { CheckCircle2 } from 'lucide-react';

const KIND_STYLES = {
  system: { dot: 'bg-slate-400', line: 'bg-slate-200' },
  bailleur: { dot: 'bg-primary', line: 'bg-primary/30' },
  professionnel: { dot: 'bg-purple-500', line: 'bg-purple-200' },
};

export default function StageStepper({ status }) {
  const currentOrder = stageOf(status).order ?? 0;
  const ended = status === 'régularisé' || status === 'abandonné';

  return (
    <div className="w-full">
      <ol className="flex items-center gap-0 overflow-x-auto pb-1">
        {STAGES.map((s, i) => {
          const done = currentOrder > s.order;
          const active = currentOrder === s.order && !ended;
          const sty = KIND_STYLES[s.kind] || KIND_STYLES.system;
          return (
            <li key={s.key} className="flex items-center shrink-0">
              <div className="flex flex-col items-center gap-1 w-[92px]">
                <div
                  className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors',
                    done && 'bg-emerald-500 border-emerald-500 text-white',
                    active && cn(sty.dot, 'border-transparent text-white'),
                    !done && !active && 'bg-muted border-border text-muted-foreground'
                  )}
                >
                  {done ? <CheckCircle2 className="w-4 h-4" /> : <span>{i + 1}</span>}
                </div>
                <span
                  className={cn(
                    'text-[10px] text-center leading-tight',
                    active ? 'font-semibold text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {s.short}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <div className={cn('h-0.5 w-6', done ? 'bg-emerald-400' : sty.line)} />
              )}
            </li>
          );
        })}
      </ol>
      {ended && (
        <div className="mt-2">
          {status === 'régularisé' ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Dette régularisée
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted border border-border rounded-full px-2 py-0.5">
              Dette abandonnée
            </span>
          )}
        </div>
      )}
    </div>
  );
}