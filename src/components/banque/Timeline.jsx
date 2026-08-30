import React from 'react';
import { FileUp, ListChecks, CheckCircle2, Lock, Check, ChevronRight, Loader2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Fil chronologique focal en 4 étapes : Importer → Rapprocher → Vérifier → Clôturer.
 * @param summary  objet renvoyé par manageMonthClose(analyze)
 * @param status   'open' | 'review' | 'closed'
 * @param onStep   callback(key) au clic — bascule l'onglet Banque
 */
const STEPS = [
  { tab: 'import', label: 'Importer', sub: 'Relevés & flux', icon: FileUp,
    done: (s) => (s?.bankTxCount || 0) > 0 },
  { tab: 'rapprocher', label: 'Rapprocher', sub: 'Catégoriser', icon: ListChecks,
    done: (s) => (s?.bankTxCount || 0) > 0 && (s?.bankPending || 0) === 0 },
  { tab: 'rapprocher', label: 'Vérifier', sub: 'Anomalies', icon: CheckCircle2,
    done: (s) => (s?.toVerifyCount || 0) === 0 && (s?.uncategorizedCount || 0) === 0 },
  { tab: 'cloture', label: 'Clôturer', sub: 'Boucler le mois', icon: Lock,
    done: (s, status) => status === 'closed' },
];

export default function Timeline({ summary, status, onStep }) {
  const resolved = STEPS.map((st) => ({ ...st, done: st.done(summary, status) }));
  // Première étape non faite = "en cours"
  const currentIdx = resolved.findIndex((st) => !st.done);
  const currentIndex = currentIdx === -1 ? resolved.length : currentIdx;

  return (
    <div className="bg-card rounded-2xl border border-border p-4 sm:p-6">
      <div className="flex items-center w-full overflow-x-auto">
        {resolved.map((st, i) => {
          const state = st.done ? 'done' : i === currentIndex ? 'current' : 'todo';
          const tone =
            state === 'done' ? 'bg-emerald-500 text-white border-emerald-500'
            : state === 'current' ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-card text-muted-foreground border-border';
          return (
            <button
              key={i}
              onClick={() => onStep(st.tab)}
              className="flex items-center min-w-0 group"
              title={`${st.label} — ${state === 'done' ? 'Fait' : state === 'current' ? 'En cours' : 'À faire'}`}
            >
              <div className="flex flex-col items-start gap-1 shrink-0">
                <div className={cn('w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all', tone,
                  state === 'current' && 'ring-4 ring-primary/20')}>
                  {state === 'done'
                    ? <Check className="w-5 h-5" />
                    : state === 'current'
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <st.icon className="w-5 h-5" />}
                </div>
                <div className="text-left">
                  <p className={cn('text-sm font-semibold leading-tight', state === 'todo' ? 'text-muted-foreground' : 'text-foreground')}>
                    {st.label}
                  </p>
                  <p className="text-xs text-muted-foreground leading-tight hidden sm:block">{st.sub}</p>
                </div>
              </div>
              {i < resolved.length - 1 && (
                <div className="flex items-center px-3 sm:px-4 pb-6">
                  <ChevronRight className={cn('w-5 h-5 shrink-0',
                    i < currentIndex ? 'text-emerald-500' : 'text-border')} />
                </div>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        {currentIndex >= resolved.length
          ? 'Toutes les étapes sont bouclées — mois clôturé.'
          : `Étape en cours : ${resolved[currentIndex].label}. Cliquez une étape pour y accéder.`}
      </p>
    </div>
  );
}