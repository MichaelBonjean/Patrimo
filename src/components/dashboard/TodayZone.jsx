import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Plus, Sparkles, CalendarDays } from 'lucide-react';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { buildTodayFeed } from '@/lib/dashboardTodayFeed';
import { toast } from 'sonner';
import ActionCard from '@/components/dashboard/ActionCard';
import PersonalReminderDialog from '@/components/dashboard/PersonalReminderDialog';

function todayISO() { return new Date().toISOString().slice(0, 10); }

function todayLabel() {
  const d = new Date();
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function TodayZone() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const [reminderOpen, setReminderOpen] = useState(false);

  const { data: attRes, isLoading: attLoading } = useQuery({
    queryKey: ['attention-queue'],
    queryFn: () => base44.functions.invoke('computeAttentionQueue', {}),
    staleTime: 60_000,
  });
  const { data: reminders = [] } = useQuery({
    queryKey: ['personal-reminders'],
    queryFn: () => base44.entities.PersonalReminder.filter(withOwner()),
    staleTime: 30_000,
  });
  const { data: calRes } = useQuery({
    queryKey: ['calendar-events-today'],
    queryFn: () => base44.functions.invoke('calendarEvents', { from: todayISO(), to: todayISO(), includeInformational: true }),
    staleTime: 60_000,
  });
  const { data: autoRes } = useQuery({
    queryKey: ['automation-rate', 'current'],
    queryFn: () => base44.functions.invoke('computeAutomationRate', {}),
    staleTime: 60_000,
  });

  const attention = (attRes?.data || attRes)?.items || [];
  const calendarEvents = calRes?.data?.events || calRes?.events || [];
  const autoRate = (autoRes?.data || autoRes)?.rate;

  const { items, counts } = buildTodayFeed({
    attention, reminders, calendarEvents, today: todayISO(),
  });

  const top = items.slice(0, 6);

  const markDone = async (item) => {
    try {
      await base44.functions.invoke('manageReminders', { op: 'mark_done', id: item.raw.id });
      toast.success('Rappel terminé ✅');
      qc.invalidateQueries({ queryKey: ['personal-reminders'] });
    } catch (e) {
      toast.error('Impossible de marquer le rappel');
    }
  };

  const rateLabel = (autoRate == null) ? null : `${autoRate} % automatisé`;

  return (
    <section id="today-zone">
      <div className="mb-3 px-1 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Aujourd'hui</h2>
          <p className="text-sm text-muted-foreground">{todayLabel()}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {counts.total > 0 ? (
              <>
                <span className="font-medium text-foreground">{counts.total} action{counts.total > 1 ? 's' : ''}</span>
                {counts.urgent > 0 && <> · <span className="text-rose-600 font-medium">{counts.urgent} urgente{counts.urgent > 1 ? 's' : ''}</span></>}
                {rateLabel && <> · <a href="#kpi-automation" className="text-primary font-medium hover:underline">{rateLabel}</a></>}
              </>
            ) : (
              <>
                Rien d'urgent à traiter
                {rateLabel && <> — <a href="#kpi-automation" className="text-primary font-medium hover:underline">{rateLabel}</a></>}
              </>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setReminderOpen(true)}>
          <Plus className="w-4 h-4" /> Noter un rappel
        </Button>
      </div>

      {attLoading && items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground animate-pulse">Analyse de votre journée…</div>
      ) : top.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
            <Sparkles className="w-7 h-7 text-emerald-600" />
          </div>
          <p className="text-base font-semibold">Journée au calme ✨</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Aucune action prioritaire aujourd'hui. Patrimo continue de traiter vos opérations en arrière-plan.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {top.map((item) => (
            <ActionCard key={item.id} item={item} onDone={item.kind === 'reminder' ? () => markDone(item) : undefined} />
          ))}
        </div>
      )}

      {items.length > 6 && (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate('/a-faire')}>
            <CalendarDays className="w-4 h-4" /> Tout voir ({items.length})
          </Button>
        </div>
      )}

      <PersonalReminderDialog open={reminderOpen} onOpenChange={setReminderOpen} />
    </section>
  );
}