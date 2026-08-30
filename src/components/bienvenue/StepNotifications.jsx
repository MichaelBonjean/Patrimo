import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Bell, Receipt } from 'lucide-react';

export default function StepNotifications({ value, onChange }) {
  const v = value || { notify_impayes: true, notify_quittances: true };
  const set = (patch) => onChange({ ...v, ...patch });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        On veille pour vous. Vous pourrez ajuster ces alertes plus tard.
      </p>

      <label htmlFor="nimp" className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 cursor-pointer">
        <span className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5 text-primary" />
          </span>
          <span>
            <span className="block text-base font-semibold">Notifier les impayés</span>
            <span className="block text-sm text-muted-foreground">On surveille chaque échéance et vous prévient.</span>
          </span>
        </span>
        <Switch id="nimp" checked={v.notify_impayes} onCheckedChange={(c) => set({ notify_impayes: c })} />
      </label>

      <label htmlFor="nqit" className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 cursor-pointer">
        <span className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <Receipt className="w-5 h-5 text-primary" />
          </span>
          <span>
            <span className="block text-base font-semibold">Rappel mensuel des quittances</span>
            <span className="block text-sm text-muted-foreground">On vous rappelle de générer les quittances du mois.</span>
          </span>
        </span>
        <Switch id="nqit" checked={v.notify_quittances} onCheckedChange={(c) => set({ notify_quittances: c })} />
      </label>
    </div>
  );
}