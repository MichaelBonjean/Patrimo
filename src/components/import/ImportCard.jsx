import React from 'react';
import {
  CheckCircle2, Loader2, AlertTriangle, FileText, XCircle, ChevronRight,
  PauseCircle, Ban, Clock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  progressSteps, STAGE_LABEL, stageDetail, labelForClassification,
} from '@/lib/importerPipeline';
import {
  QUEUED, OCR_RUNNING, CLASSIFYING, EXTRACTING, PAUSED, AWAITING_REVIEW,
  COMMITTED, CANCELLED, FAILED, REJECTED,
} from '@/lib/documentQueue';

/**
 * Carte de suivi d'un DocumentImport dans la file d'analyse séquentielle.
 *
 * États visuels :
 *  - queued      : gris, « En attente — position N » ;
 *  - running     : barre active + spinner ;
 *  - paused      : barre figée + PauseCircle (ambrette) ;
 *  - awaiting_review : review CTA « Vérifier & valider » ;
 *  - committed / cancelled / failed / rejected : état terminal.
 *
 * Les boutons Pause / Reprendre / Arrêter sont ajoutés à l'étape 2 (P2 du
 * chantier file séquentielle) — cette carte reste un composant d'affichage.
 */
export default function ImportCard({ record, onReview, onDismiss, queuePosition }) {
  const s = record?.status || QUEUED;
  const stage = STAGE_LABEL[s] || STAGE_LABEL[QUEUED];
  const steps = progressSteps(record);
  const pct = Math.max(0, Math.min(100, Math.round(Number(record?.progress_percent) || 0)));
  const isQueued = s === QUEUED;
  const isRunning = s === OCR_RUNNING || s === CLASSIFYING || s === EXTRACTING;
  const isPaused = s === PAUSED;
  const isReview = s === AWAITING_REVIEW;
  const isError = s === FAILED || s === REJECTED;
  const isCancelled = s === CANCELLED;
  const isDone = s === COMMITTED;
  const isTerminal = isDone || isError || isCancelled;

  const showBar = isQueued || isRunning || isPaused;
  const totalPages = Number(record?.total_pages) || 0;
  const processedPages = Number(record?.processed_pages) || 0;
  const showPages = showBar && totalPages > 1 && processedPages > 0;

  const icon = isRunning
    ? <Loader2 className="w-4 h-4 animate-spin" />
    : isDone ? <CheckCircle2 className="w-4 h-4" />
    : isPaused ? <PauseCircle className="w-4 h-4" />
    : isCancelled ? <Ban className="w-4 h-4" />
    : isError ? <XCircle className="w-4 h-4" />
    : isQueued ? <Clock className="w-4 h-4" />
    : <FileText className="w-4 h-4" />;

  const toneClass = isDone
    ? 'bg-emerald-100 text-emerald-700'
    : isReview ? 'bg-primary/10 text-primary'
    : isPaused ? 'bg-amber-100 text-amber-700'
    : isCancelled ? 'bg-muted text-muted-foreground'
    : isError ? 'bg-destructive/10 text-destructive'
    : 'bg-muted text-muted-foreground';

  return (
    <div className={cn(
      'rounded-xl border bg-card p-4 transition-colors',
      isReview ? 'border-primary/40' : isPaused ? 'border-amber-300' :
      isError ? 'border-destructive/40' : 'border-border'
    )}>
      <div className="flex items-start gap-3">
        <span className={cn(
          'flex items-center justify-center w-9 h-9 rounded-full shrink-0', toneClass
        )}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">{record.file_name}</p>
            <Badge variant="secondary" className="text-[10px] shrink-0">
              {labelForClassification(record.classification)}
            </Badge>
            {isQueued && queuePosition != null && (
              <Badge variant="outline" className="text-[10px] shrink-0">
                Position {queuePosition}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {stage.label}
            {record.error_message ? ` — ${record.error_message}` : ''}
          </p>

          {(showBar) && (
            <div className="mt-2 space-y-1">
              <Progress
                value={pct}
                className={cn('h-2', isPaused && '[&>div]:bg-amber-500')}
              />
              <p className="text-xs text-muted-foreground">
                {stageDetail(record.current_stage) || stage.label}
                {showPages && (
                  <span className="text-muted-foreground/70">
                    {' · '}{isRunning ? 'page' : ''} {processedPages} / {totalPages}
                  </span>
                )}
                {pct > 0 && !isQueued && (
                  <span className="text-muted-foreground/70"> · {pct} %</span>
                )}
              </p>
            </div>
          )}

          {isReview && (
            <ul className="mt-2 space-y-1">
              {steps.map((st) => (
                <li key={st.key} className="flex items-center gap-2 text-xs">
                  {st.ok
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    : st.warn
                      ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      : <span className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30 shrink-0" />}
                  <span className={cn(st.warn ? 'text-amber-700' : 'text-muted-foreground')}>{st.label}</span>
                </li>
              ))}
            </ul>
          )}

          {isReview && (
            <button
              onClick={() => onReview?.(record)}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Vérifier & valider <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
        {(onDismiss && isTerminal) && (
          <button onClick={() => onDismiss(record)} className="text-muted-foreground hover:text-destructive text-xs shrink-0">
            Fermer
          </button>
        )}
      </div>
    </div>
  );
}