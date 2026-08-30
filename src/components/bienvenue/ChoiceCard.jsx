import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Grosse carte sélectionnable (wizard novice) — zone tactile large, style rassurant.
 */
export default function ChoiceCard({ icon: Icon, title, subtitle, selected, onClick, accent }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-2xl border p-4 sm:p-5 transition-all min-h-[88px] flex items-start gap-3.5',
        selected
          ? 'border-primary bg-primary/5 ring-2 ring-primary/30 shadow-sm'
          : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40'
      )}
    >
      {Icon && (
        <span
          className={cn(
            'shrink-0 w-11 h-11 rounded-xl flex items-center justify-center',
            selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          )}
        >
          <Icon className="w-5 h-5" />
        </span>
      )}
      <span className="flex-1">
        <span className="block text-base font-semibold leading-tight">{title}</span>
        {subtitle && (
          <span className="block text-sm text-muted-foreground mt-1 leading-snug">{subtitle}</span>
        )}
      </span>
    </button>
  );
}