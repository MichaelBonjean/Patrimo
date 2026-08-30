import React from 'react';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Badge inline "cadenas + texte de déblocage" pour les routes/items verrouillés.
 */
export function LockBadge({ unlockText, className }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-[11px] text-muted-foreground', className)}
      title={unlockText}
    >
      <Lock className="w-3 h-3 shrink-0" />
      <span className="truncate">{unlockText}</span>
    </span>
  );
}

/**
 * Panneau de remplacement pour une feature verrouillée (cadre pointillé + cadenas).
 */
export default function LockedPanel({ title, desc, unlockText, icon: Icon, className }) {
  return (
    <div className={cn('rounded-xl border border-dashed border-border bg-muted/30 p-5 flex items-start gap-3', className)}>
      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <Lock className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
          {title}
        </h3>
        {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
        {unlockText && (
          <p className="text-xs text-primary mt-3 font-medium flex items-center gap-1">
            <Lock className="w-3 h-3" /> {unlockText}
          </p>
        )}
      </div>
    </div>
  );
}