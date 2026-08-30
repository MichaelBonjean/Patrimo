/**
 * Badge de catégorie de transaction : libellé + pastille colorée par domaine métier.
 *
 * Couleur déterminée par `colorForCategoryKey` (loyers→emerald, banque→blue, etc.).
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { labelOf } from '@/lib/financeCategories';
import { colorForCategoryKey, _bindCategoryResolver, colorForDomain, DOMAIN_OF_CATEGORY } from '@/lib/iconColors';
import { resolveKey } from '@/lib/financeCategories';

// Branche le résolveur de clé canonique (libellés legacy → clé) une seule fois.
_bindCategoryResolver(resolveKey);

export default function CategoryBadge({ category, className }) {
  const color = colorForCategoryKey(category);
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', color, className)}>
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
      {labelOf(category)}
    </span>
  );
}

export { colorForDomain, DOMAIN_OF_CATEGORY };