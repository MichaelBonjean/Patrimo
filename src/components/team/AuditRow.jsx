import React from 'react';
import { Badge } from '@/components/ui/badge';

const ACTION_LABEL = {
  create: 'Création',
  update: 'Modification',
  delete: 'Suppression',
  import: 'Import',
  reconcile: 'Rapprochement',
  quittance: 'Quittance',
  financial_change: 'Changement financier',
  admin_access: 'Accès administratif',
  other: 'Autre',
};

const ACTION_CLASS = {
  create: 'bg-blue-100 text-blue-700',
  update: 'bg-slate-100 text-slate-700',
  delete: 'bg-red-100 text-red-700',
  import: 'bg-violet-100 text-violet-700',
  reconcile: 'bg-cyan-100 text-cyan-700',
  quittance: 'bg-emerald-100 text-emerald-700',
  financial_change: 'bg-amber-100 text-amber-700',
  admin_access: 'bg-fuchsia-100 text-fuchsia-700',
  other: 'bg-slate-100 text-slate-600',
};

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function AuditRow({ entry }) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/40">
      <td className="py-2.5 px-3 align-top whitespace-nowrap text-sm">{formatDate(entry.date)}</td>
      <td className="py-2.5 px-3 align-top text-sm">
        <div className="font-medium truncate">{entry.actor_email}</div>
        {entry.actor_role && <div className="text-xs text-muted-foreground">{entry.actor_role}</div>}
      </td>
      <td className="py-2.5 px-3 align-top">
        <Badge variant="secondary" className={ACTION_CLASS[entry.action] || ACTION_CLASS.other}>
          {ACTION_LABEL[entry.action] || entry.action}
        </Badge>
      </td>
      <td className="py-2.5 px-3 align-top text-sm">
        <div className="font-medium">{entry.entity_type || '—'}</div>
        {entry.entity_label && <div className="text-xs text-muted-foreground truncate max-w-[220px]">{entry.entity_label}</div>}
      </td>
      <td className="py-2.5 px-3 align-top text-xs text-muted-foreground max-w-[280px] truncate">
        {entry.details && Object.keys(entry.details).length ? JSON.stringify(entry.details) : '—'}
      </td>
    </tr>
  );
}