import React from 'react';
import { cn } from '@/lib/utils';

/**
 * État vide unifié : mini-landing page centrée, max-w-md, padding généreux.
 * @param illustration - composant SVG (stroke 1.5, palette marque)
 * @param title - titre 20px gras
 * @param subtitle - sous-titre 15px muted
 * @param children - contenu additionnel (ex: liste docs recommandés) placé sous le sous-titre
 * @param primary / secondary - de 0 à 2 CTA (renders as-is)
 */
export default function EmptyState({
  illustration,
  title,
  subtitle,
  children,
  primary,
  secondary,
  className,
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center max-w-md mx-auto py-14 md:py-20 px-6', className)}>
      {illustration && <div className="mb-6">{illustration}</div>}
      <h2 className="text-[20px] font-bold tracking-tight text-foreground leading-snug">{title}</h2>
      {subtitle && <p className="text-[15px] text-muted-foreground mt-2 leading-relaxed">{subtitle}</p>}
      {children && <div className="mt-4">{children}</div>}
      {(primary || secondary) && (
        <div className="flex flex-wrap items-center justify-center gap-3 mt-7">
          {primary}
          {secondary}
        </div>
      )}
    </div>
  );
}