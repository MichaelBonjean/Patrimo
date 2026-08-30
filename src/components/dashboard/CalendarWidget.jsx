import React, { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { format, parseISO, isToday, isSameMonth, addDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Filter, CalendarDays, ChevronDown, CalendarOff, Sparkles } from 'lucide-react';
import EventCard, { CATEGORY_LABEL } from './calendar/EventCard';

const todayISO = () => new Date().toISOString().slice(0, 10);

const SECTIONS = [
  { key: 'overdue', title: 'En retard', color: 'text-red-600' },
  { key: 'today', title: "Aujourd'hui", color: 'text-primary' },
  { key: 'week', title: 'Cette semaine', color: 'text-foreground' },
  { key: 'month', title: 'Ce mois-ci', color: 'text-foreground' },
  { key: 'later', title: 'Plus tard', color: 'text-muted-foreground' },
  { key: 'snoozed', title: 'Reportés', color: 'text-amber-600', collapsed: true },
];

function groupSections(events, now) {
  const buckets = { overdue: [], today: [], week: [], month: [], later: [], snoozed: [] };
  const anchor = parseISO(now);
  for (const e of events) {
    if (e.snoozed) { buckets.snoozed.push(e); continue; }
    const d = parseISO(e.date);
    if (isToday(d)) buckets.today.push(e);
    else if (d < anchor) buckets.overdue.push(e);
    else if (d <= addDays(anchor, 7)) buckets.week.push(e);
    else if (isSameMonth(d, anchor)) buckets.month.push(e);
    else buckets.later.push(e);
  }
  return buckets;
}

export default function CalendarWidget() {
  const [searchParams] = useSearchParams();
  const [includeSnoozed, setIncludeSnoozed] = useState(true);
  const [includeInformational, setIncludeInformational] = useState(true);
  const [catFilter, setCatFilter] = useState(null); // Set<string> | null
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  const scrollRef = useRef(null);

  const now = todayISO();
  const from = addDays(parseISO(now), -90).toISOString().slice(0, 10);
  const to = addDays(parseISO(now), 120).toISOString().slice(0, 10);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['calendar-events', from, to, includeSnoozed, includeInformational],
    queryFn: async () => {
      const res = await base44.functions.invoke('calendarEvents', { from, to, includeSnoozed, includeInformational });
      const payload = res?.data ?? res;
      return payload?.events || [];
    },
  });

  // Deep-link : /?tab=calendrier → scroll vers la widget
  React.useEffect(() => {
    if (searchParams.get('tab') === 'calendrier' && scrollRef.current) {
      setTimeout(() => scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }
  }, [searchParams]);

  const events = useMemo(() => {
    if (!data) return [];
    let evs = data;
    if (catFilter && catFilter.size > 0) evs = evs.filter((e) => catFilter.has(e.category));
    return evs;
  }, [data, catFilter]);

  const buckets = useMemo(() => groupSections(events, now), [events, now]);
  const weekCount = buckets.today.length + buckets.week.length;
  const [expanded, setExpanded] = useState(new Set());
  const CAP = 12;
  const toggleExpand = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const toggleCat = (cat) => {
    setCatFilter((prev) => {
      const next = new Set(prev || []);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next.size ? next : null;
    });
  };

  return (
    <div ref={scrollRef} id="calendrier" className="my-8 rounded-2xl border border-border bg-card/60 overflow-hidden">
      {/* Header */}
      <div className="p-6 flex items-start justify-between gap-3 flex-wrap border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Mon agenda</h2>
            <p className="text-sm text-muted-foreground">
              {isError ? 'Impossible de charger l\'agenda.'
                : isLoading ? 'Chargement de vos échéances…'
                : `${weekCount} action${weekCount > 1 ? 's' : ''} à venir cette semaine`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Filter className="w-3.5 h-3.5" /> Filtrer
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4 space-y-4" align="end">
              <div className="space-y-3">
                <label className="flex items-center justify-between text-sm">
                  <span>Inclure les reportés</span>
                  <Switch checked={includeSnoozed} onCheckedChange={setIncludeSnoozed} />
                </label>
                <label className="flex items-center justify-between text-sm">
                  <span>Événements informatifs</span>
                  <Switch checked={includeInformational} onCheckedChange={setIncludeInformational} />
                </label>
              </div>
              <div className="border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Type d'événement</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(CATEGORY_LABEL).map(([key, label]) => {
                    const active = catFilter?.has(key);
                    return (
                      <button
                        key={key}
                        onClick={() => toggleCat(key)}
                        className={`px-2 py-1 rounded-md text-xs border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Body */}
      <div className="p-6">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        )}
        {isError && (
          <div className="text-center py-10 text-sm text-muted-foreground">
            Échec du chargement de l'agenda.
            <div className="mt-3"><Button variant="outline" size="sm" onClick={() => refetch()}>Réessayer</Button></div>
          </div>
        )}
        {!isLoading && !isError && events.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Aucune action prévue cette semaine ✨</p>
          </div>
        )}
        {!isLoading && !isError && events.length > 0 && (
          <div className="space-y-6">
            {SECTIONS.filter((s) => buckets[s.key].length > 0).map((s) => {
              const list = buckets[s.key];
              const isSnoozedSection = s.key === 'snoozed';
              return (
                <div key={s.key}>
                  <button
                    className="flex items-center gap-2 mb-2 w-full text-left"
                    onClick={() => isSnoozedSection && setSnoozedOpen((o) => !o)}
                    aria-expanded={isSnoozedSection ? snoozedOpen : undefined}
                  >
                    <span className={`text-sm font-semibold ${s.color}`}>{s.title}</span>
                    <Badge variant="secondary" className="text-[11px]">{list.length}</Badge>
                    {isSnoozedSection && (
                      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${snoozedOpen ? 'rotate-180' : ''}`} />
                    )}
                  </button>
                  {(!isSnoozedSection || snoozedOpen) && (
                    <div className="space-y-2">
                      {(isSnoozedSection ? list : list.slice(0, expanded.has(s.key) ? list.length : CAP)).map((e) =>
                        isSnoozedSection ? (
                          <div key={e.id}>
                            <EventCard event={e} snoozed />
                            <p className="text-[11px] text-muted-foreground mt-0.5 ml-1">
                              Reporté jusqu'au {format(parseISO(e.snoozedUntil), 'dd/MM/yyyy', { locale: fr })}
                            </p>
                          </div>
                        ) : <EventCard key={e.id} event={e} snoozed={false} />
                      )}
                      {!isSnoozedSection && list.length > CAP && !expanded.has(s.key) && (
                        <button onClick={() => toggleExpand(s.key)} className="text-xs text-primary hover:underline pl-1">
                          Voir les {list.length - CAP} autres
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}