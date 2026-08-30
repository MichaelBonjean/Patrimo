import React from 'react';
import { Loader2 } from 'lucide-react';
import { useSlowLoading } from '@/lib/useSlowLoading';
import { cn } from '@/lib/utils';

/**
 * Affiche un message descriptif (spinner + texte) uniquement après >2s de chargement.
 * Tant que le chargement est rapide, rien ne s'affiche.
 *
 * Props:
 *  - isLoading: boolean
 *  - message: string (ex: "Analyse de 247 transactions...")
 *  - delay: number (ms, défaut 2000)
 */
export default function SlowLoadingMessage({ isLoading, message, delay = 2000, className }) {
  const slow = useSlowLoading(isLoading, delay);
  if (!slow || !message) return null;
  return (
    <div
      role="status"
      className={cn(
        'flex items-center justify-center gap-2 text-sm text-muted-foreground py-3 px-4 animate-in fade-in',
        className
      )}
    >
      <Loader2 className="w-4 h-4 animate-spin text-primary" />
      <span className="number-fr">{message}</span>
    </div>
  );
}