import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import {
  format, parseISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, isToday, addMonths, getYear,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import EventCard, { COLOR_CLASSES, CATEGORY_LABEL } from './EventCard';

const DOT_CLASSES = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  primary: 'bg-primary',
  gray: 'bg-slate-400',
};

const WEEKDAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];

export default function CalendarMonthDialog({ open, onOpenChange }) {
  const [cursor, setCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const year = getYear(cursor);
  const { from, to } = useMemo(() => {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    return { from: format(start, 'yyyy-MM-dd'), to: format(end, 'yyyy-MM-dd') };
  }, [year]);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['calendarEvents', 'month', from, to],
    queryFn: async () => {
      const res = await base44.functions.invoke('calendarEvents', { from, to, includeSnoozed: true, includeInformational: true });
      const payload = res?.data ?? res;
      return payload?.events || [];
    },
    enabled: open,
  });

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const byDate = useMemo(() => {
    const map = {};
    for (const e of events) {
      if (!e?.date) continue;
      (map[e.date] ||= []).push(e);
    }
    return map;
  }, [events]);

  const selectedKey = format(selectedDate, 'yyyy-MM-dd');
  const selectedEvents = byDate[selectedKey] || [];

  const prevMonth = () => setCursor((d) => addMonths(d, -1));
  const nextMonth = () => setCursor((d) => addMonths(d, 1));
  const goToday = () => { const t = new Date(); setCursor(t); setSelectedDate(t); };

  // Empêche le scroll du fond
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="w-5 h-5 text-primary" />
            Mon agenda
          </DialogTitle>
          <DialogDescription className="text-xs">
            Vue mensuelle — toutes vos échéances locatives et administratives consolidées.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto p-4">
          {/* Légende */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-4">
            {Object.entries(CATEGORY_LABEL).map(([cat, label]) => (
              <span key={cat} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={cn('w-2 h-2 rounded-full',
                  cat === 'rent_due' ? DOT_CLASSES.blue :
                  cat === 'unpaid' ? DOT_CLASSES.red :
                  cat === 'lease' ? DOT_CLASSES.primary :
                  cat === 'irl_revision' ? DOT_CLASSES.green :
                  cat === 'charge_reg' ? DOT_CLASSES.amber :
                  cat === 'document_expiring' ? DOT_CLASSES.amber :
                  cat === 'month_close' ? DOT_CLASSES.gray :
                  cat === 'alert' ? DOT_CLASSES.red :
                  cat === 'quittance_missing' ? DOT_CLASSES.blue :
                  cat === 'loan_installment' ? DOT_CLASSES.red :
                  DOT_CLASSES.gray)} />
                {label}
              </span>
            ))}
          </div>

          <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4">
            {/* Grille mois */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Button variant="ghost" size="icon" onClick={prevMonth} aria-label="Mois précédent">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="text-center">
                  <p className="text-base font-semibold capitalize">
                    {format(cursor, 'MMMM yyyy', { locale: fr })}
                  </p>
                  <button onClick={goToday} className="text-[11px] text-primary hover:underline">
                    Aujourd'hui
                  </button>
                </div>
                <Button variant="ghost" size="icon" onClick={nextMonth} aria-label="Mois suivant">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border border-border">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="bg-muted py-1.5 text-center text-[11px] font-medium text-muted-foreground">
                    {d}
                  </div>
                ))}
                {days.map((day) => {
                  const key = format(day, 'yyyy-MM-dd');
                  const dayEvents = byDate[key] || [];
                  const inMonth = isSameMonth(day, cursor);
                  const isSel = isSameDay(day, selectedDate);
                  const today = isToday(day);
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDate(day)}
                      className={cn(
                        'min-h-[64px] sm:min-h-[78px] p-1.5 text-left bg-card hover:bg-muted/50 transition-colors flex flex-col gap-1',
                        !inMonth && 'opacity-40',
                        isSel && 'ring-2 ring-inset ring-primary'
                      )}
                    >
                      <span className={cn(
                        'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium shrink-0',
                        today ? 'bg-primary text-primary-foreground' : 'text-foreground'
                      )}>
                        {format(day, 'd')}
                      </span>
                      <div className="flex flex-col gap-0.5 overflow-hidden">
                        {dayEvents.slice(0, 3).map((e) => (
                          <span key={e.id} className={cn('w-full text-[10px] truncate rounded px-1 py-0.5',
                            COLOR_CLASSES[e.color] || COLOR_CLASSES.gray)}>
                            {e.title}
                          </span>
                        ))}
                        {dayEvents.length > 3 && (
                          <span className="text-[10px] text-muted-foreground px-1">
                            +{dayEvents.length - 3} autre{dayEvents.length - 3 > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              {isLoading && (
                <p className="text-xs text-muted-foreground mt-3">Chargement des échéances…</p>
              )}
            </div>

            {/* Détail du jour sélectionné */}
            <div className="border rounded-lg p-3 bg-card">
              <p className="text-sm font-semibold mb-1 capitalize">
                {format(selectedDate, 'EEEE d MMMM', { locale: fr })}
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                {selectedEvents.length} action{selectedEvents.length > 1 ? 's' : ''} ce jour
              </p>
              <div className="space-y-2">
                {selectedEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Aucune échéance ce jour.</p>
                ) : (
                  selectedEvents.map((e) => <EventCard key={e.id} event={e} snoozed={!!e.snoozed} />)
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}