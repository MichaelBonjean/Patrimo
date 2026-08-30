import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CalendarClock, Gauge, RefreshCw, ShieldAlert, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

const TYPE = {
  impaye: { icon: AlertTriangle, color: 'text-rose-600 bg-rose-50' },
  bank: { icon: RefreshCw, color: 'text-amber-600 bg-amber-50' },
  quittance: { icon: FileText, color: 'text-amber-600 bg-amber-50' },
  lease: { icon: CalendarClock, color: 'text-amber-600 bg-amber-50' },
  dpe: { icon: Gauge, color: 'text-blue-600 bg-blue-50' },
  indexation: { icon: RefreshCw, color: 'text-blue-600 bg-blue-50' },
  insurance: { icon: ShieldAlert, color: 'text-blue-600 bg-blue-50' },
};

export default function ActionsSection({ actions = [] }) {
  return (
    <section className="bg-card rounded-xl border border-border">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', actions.length > 0 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600')}>
          {actions.length > 0 ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
        </div>
        <div>
          <h2 className="text-base font-semibold">Actions à traiter</h2>
          <p className="text-xs text-muted-foreground">
            {actions.length === 0 ? 'Rien à signaler — portefeuille à jour' : `${actions.length} action(s) requièrent votre attention`}
          </p>
        </div>
      </div>
      <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {actions.length === 0 ? (
          <div className="col-span-full flex items-center justify-center py-6 text-emerald-600 text-sm">
            <CheckCircle2 className="w-5 h-5 mr-2" /> Aucune action prioritaire détectée.
          </div>
        ) : actions.map((a) => {
          const t = TYPE[a.type] || TYPE.bank;
          const Icon = t.icon;
          return (
            <Link key={a.id} to={a.link} className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/40 transition-colors">
              <div className={cn('p-2 rounded-lg shrink-0', t.color)}><Icon className="w-4 h-4" /></div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{a.label}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{a.detail}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}