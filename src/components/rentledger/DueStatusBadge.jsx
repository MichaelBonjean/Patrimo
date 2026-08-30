import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const MAP = {
  unpaid: { label: 'À payer', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  partial: { label: 'Partiel', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  paid: { label: 'Soldé', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  overpaid: { label: 'Trop-perçu', cls: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
};

export default function DueStatusBadge({ status }) {
  const m = MAP[status] || MAP.unpaid;
  return (
    <Badge variant="outline" className={cn('border', m.cls)}>
      {m.label}
    </Badge>
  );
}