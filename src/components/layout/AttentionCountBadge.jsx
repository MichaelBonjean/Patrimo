import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { cn } from '@/lib/utils';

/**
 * Badge de compteur live pour la file d'attention — affiché dans la navigation
 * latérale à côté de l'entrée « À faire ». Ne rend rien s'il n'y a rien à faire.
 */
export default function AttentionCountBadge({ active }) {
  const { data } = useQuery({
    queryKey: ['attention-queue'],
    queryFn: () => base44.functions.invoke('computeAttentionQueue', {}),
    staleTime: 60_000,
  });
  const count = data?.data?.count ?? data?.count ?? 0;
  if (!count) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold leading-none',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-amber-500 text-white'
      )}
    >
      {count}
    </span>
  );
}