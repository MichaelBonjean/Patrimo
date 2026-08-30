import React from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, AlertTriangle, FileSignature, TrendingUp, FolderClock,
  ShieldAlert, CalendarCheck, Bell, Receipt, Banknote, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const ICON_MAP = {
  Wallet, AlertTriangle, FileSignature, TrendingUp, FolderClock,
  ShieldAlert, CalendarCheck, Bell, Receipt, Banknote,
};

export const COLOR_CLASSES = {
  red: 'text-red-600 bg-red-50 border-red-100',
  amber: 'text-amber-600 bg-amber-50 border-amber-100',
  blue: 'text-blue-600 bg-blue-50 border-blue-100',
  green: 'text-emerald-600 bg-emerald-50 border-emerald-100',
  primary: 'text-primary bg-primary/10 border-primary/20',
  gray: 'text-slate-500 bg-slate-100 border-slate-200',
};

export const PRIORITY_BADGE = {
  urgent: 'bg-red-100 text-red-700',
  important: 'bg-orange-100 text-orange-700',
  a_traiter: 'bg-amber-100 text-amber-700',
  information: 'bg-blue-100 text-blue-700',
};

export const CATEGORY_LABEL = {
  rent_due: 'Loyer', unpaid: 'Impayé', lease: 'Bail', irl_revision: 'Révision',
  charge_reg: 'Charges', document_expiring: 'Document', month_close: 'Clôture',
  alert: 'Alerte', quittance_missing: 'Quittance', loan_installment: 'Crédit',
};

export default function EventCard({ event, snoozed }) {
  const Icon = ICON_MAP[event.icon] || Bell;
  const colorCls = COLOR_CLASSES[event.color] || COLOR_CLASSES.gray;
  const prioCls = PRIORITY_BADGE[event.priority] || PRIORITY_BADGE.information;
  const catLabel = CATEGORY_LABEL[event.category] || event.category;
  const to = snoozed ? undefined : event.actionUrl || '#';
  const content = (
    <div
      className={cn(
        'group flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/40 transition-colors',
        snoozed && 'opacity-70 border-dashed'
      )}
    >
      <div className={cn('shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center', colorCls)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{event.title}</p>
        <p className="text-xs text-muted-foreground truncate">{event.subtitle}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {snoozed && <span className="text-[11px] text-muted-foreground italic">Reporté</span>}
        <span className={cn('hidden sm:inline px-1.5 py-0.5 rounded text-[10px] font-medium', prioCls)}>{catLabel}</span>
        {!snoozed && <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />}
      </div>
    </div>
  );
  if (snoozed) return <div>{content}</div>;
  return <Link to={to} aria-label={event.title}>{content}</Link>;
}