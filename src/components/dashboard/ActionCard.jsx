import React from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, AlertTriangle, FileWarning, Bell, CircleAlert, CalendarClock,
  FileSignature, TrendingUp, FolderClock, ShieldAlert, CalendarCheck,
  Receipt, Banknote, CheckCircle2, ArrowRight,
} from 'lucide-react';
import { URGENCY } from '@/lib/dashboardTodayFeed';

const DOMAIN_ICONS = {
  payment: Wallet,
  document: FileWarning,
  impaye: AlertTriangle,
  alert: Bell,
  rentRevision: CircleAlert,
  monthClose: CalendarClock,
};

const CALENDAR_ICONS = {
  Wallet, AlertTriangle, FileSignature, TrendingUp, FolderClock,
  ShieldAlert, CalendarCheck, Bell, Receipt, Banknote,
};

function iconFor(item) {
  if (item.kind === 'queue') return DOMAIN_ICONS[item.domain] || Bell;
  if (item.kind === 'reminder') return Bell;
  if (item.kind === 'calendar') return CALENDAR_ICONS[item.icon] || CalendarCheck;
  return Bell;
}

const URGENCY_MAP = {
  error: URGENCY.error,
  action: URGENCY.action,
  reminder: URGENCY.reminder,
  confirmation: URGENCY.confirmation,
  calendar: URGENCY.calendar,
};

const DONE_LABEL = { queue: 'Traiter', reminder: 'Fait', calendar: 'Voir' };

export default function ActionCard({ item, onDone }) {
  const Icon = iconFor(item);
  const u = URGENCY_MAP[item.urgencyKey] || URGENCY.calendar;
  const content = (
    <div className={`flex items-start gap-3 p-3.5 rounded-xl border border-border border-l-4 ${u.border} bg-card hover:shadow-sm transition-shadow`}>
      <div className={`p-2 rounded-lg shrink-0 bg-muted/60 ${u.icon}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight line-clamp-2">{item.title}</p>
        {item.subtitle && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.subtitle}</p>}
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {item.kind === 'reminder' ? 'Rappel personnel' :
             item.kind === 'calendar' ? 'Agenda' :
             u.key === 'error' ? 'Urgent' : u.key === 'action' ? 'Action requise' : 'À confirmer'}
          </span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {item.kind === 'reminder' && onDone && (
          <button type="button" onClick={onDone} title="Marquer comme fait"
            className="p-1.5 rounded-md hover:bg-emerald-50 text-emerald-600 transition-colors">
            <CheckCircle2 className="w-4 h-4" />
          </button>
        )}
        {item.action_url && <ArrowRight className="w-4 h-4 text-muted-foreground" />}
      </div>
    </div>
  );

  if (item.action_url) {
    return <Link to={item.action_url} className="block">{content}</Link>;
  }
  return content;
}