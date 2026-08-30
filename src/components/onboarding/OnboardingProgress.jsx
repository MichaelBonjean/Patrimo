import React from 'react';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Barre de progression d'onboarding + actions restantes importantes.
 * Affichée en haut de l'assistant et disponible pour le Dashboard.
 */
export default function OnboardingProgress({ progress, onJump }) {
  const { percent, checks, remaining } = progress;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-baseline justify-between mb-1.5">
            <p className="text-sm font-medium text-foreground">Votre patrimoine est configuré à {percent}%</p>
            <p className="text-xs text-muted-foreground">{checks.filter((c) => c.done).length}/{checks.total} étapes</p>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {checks.map((c) => (
          <div
            key={c.key}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs',
              c.done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-border bg-muted/40 text-muted-foreground'
            )}
          >
            {c.done ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <Circle className="w-3.5 h-3.5 shrink-0" />}
            <span className="truncate">{c.label}</span>
          </div>
        ))}
      </div>

      {remaining.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-xs font-semibold text-amber-800 mb-2">Actions réellement importantes restantes</p>
          <div className="flex flex-wrap gap-2">
            {remaining.slice(0, 3).map((c) => (
              <Button
                key={c.key}
                size="sm"
                variant="outline"
                className="h-7 text-xs bg-white border-amber-200 text-amber-800 hover:bg-amber-50"
                onClick={() => onJump?.(c.step)}
              >
                {c.cta} <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}