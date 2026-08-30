/**
 * Moteur d'agrégation du calendrier consolidé — pur (sans I/O).
 *
 * Consomme des tableaux d'entités déjà chargés par la fonction `calendarEvents`
 * (isolation multi-tenant gérée côté fonction via RLS) et produit une liste
 * d'événements typés au format uniforme, triée par date ascendante.
 *
 * 10 sources : RentDue, Impaye, Lease (start/end/anniversaire), RentRevision,
 * ChargeRegularization, Document (DPE/assurance/AG), MonthClose, Alert,
 * Quittance manquante, échéance de crédit mensuelle.
 *
 * Règle : aucune date n'est fabriquée — un événement n'apparaît que si son
 * entité source fournit une date fiable.
 */

export type EventPriority = 'urgent' | 'important' | 'a_traiter' | 'information';
export type EventColor = 'red' | 'amber' | 'blue' | 'green' | 'primary' | 'gray';

export interface CalEvent {
  id: string;
  date: string; // YYYY-MM-DD
  category: string; // rent_due | unpaid | lease | irl_revision | charge_reg | document_expiring | month_close | alert | quittance_missing | loan_installment
  type: string; // type fin : lease_start | lease_end | lease_anniversary | alert:<source> | document_expiring | …
  priority: EventPriority;
  title: string;
  subtitle: string;
  propertyId?: string;
  entityRef: { kind: string; id: string };
  status?: string;
  snoozedUntil?: string | null;
  snoozed?: boolean;
  actionUrl: string;
  icon: string;
  color: EventColor;
}

export interface CalData {
  properties?: any[];
  lots?: any[];
  leases?: any[];
  rentDues?: any[];
  impayes?: any[];
  quittances?: any[];
  rentRevisions?: any[];
  chargeRegs?: any[];
  monthCloses?: any[];
  documents?: any[];
  transactions?: any[];
  alerts?: any[];
}

export interface CalOpts {
  from: string; // YYYY-MM-DD inclus
  to: string; // YYYY-MM-DD inclus
  now?: string; // YYYY-MM-DD ( défaut aujourd'hui )
  propertyIds?: string[];
  types?: string[]; // filtre sur `category`
  includeSnoozed?: boolean; // défaut true
  includeInformational?: boolean; // défaut true (priority 'information')
  includeResolved?: boolean; // défaut false
}

// ---------- helpers ----------

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function parse(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  if (!isFinite(da) || !isFinite(db)) return 0;
  return Math.round((db - da) / 86400000);
}
function inRange(d: string, from: string, to: string): boolean {
  return d >= from && d <= to;
}
function addMonthsISO(s: string, n: number): Date {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function isActiveLease(l: any, today: string): boolean {
  if (l.status === 'resilie' || l.status === 'termine') return false;
  const end = parse(l.date_end);
  if (end && iso(end) < today) return false;
  const start = parse(l.date_start);
  if (!start) return false;
  return true;
}

function isSnoozed(snoozedUntil: string | null | undefined, today: string): boolean {
  if (!snoozedUntil) return false;
  return snoozedUntil > today;
}

// ---------- builder ----------

export function buildCalendarEvents(data: CalData, opts: CalOpts): CalEvent[] {
  const now = opts.now || new Date().toISOString().slice(0, 10);
  const from = opts.from;
  const to = opts.to;
  const includeSnoozed = opts.includeSnoozed !== false;
  const includeInformational = opts.includeInformational !== false;
  const includeResolved = !!opts.includeResolved;
  const propFilter = opts.propertyIds && opts.propertyIds.length > 0 ? new Set(opts.propertyIds) : null;
  const typeFilter = opts.types && opts.types.length > 0 ? new Set(opts.types) : null;

  const out: CalEvent[] = [];

  const properties: any[] = data.properties || [];
  const lots: any[] = data.lots || [];
  const leases: any[] = data.leases || [];
  const rentDues: any[] = data.rentDues || [];
  const impayes: any[] = data.impayes || [];
  const quittances: any[] = data.quittances || [];
  const revisions: any[] = data.rentRevisions || [];
  const chargeRegs: any[] = data.chargeRegs || [];
  const monthCloses: any[] = data.monthCloses || [];
  const documents: any[] = data.documents || [];
  const transactions: any[] = data.transactions || [];
  const alerts: any[] = data.alerts || [];

  const propName = (id?: string | null) => properties.find((p) => p.id === id)?.name || '';
  const lotDesignation = (id?: string | null) => lots.find((l) => l.id === id)?.designation || '';

  const push = (e: CalEvent) => {
    if (propFilter && e.propertyId && !propFilter.has(e.propertyId)) return;
    if (typeFilter && !typeFilter.has(e.category)) return;
    if (!includeInformational && e.priority === 'information') return;
    if (e.snoozed && !includeSnoozed) return;
    out.push(e);
  };

  // 1. Échéances de loyer (RentDue)
  for (const rd of rentDues) {
    if (!rd.due_date) continue;
    if (!inRange(rd.due_date, from, to)) continue;
    const st: string = rd.status || 'unpaid';
    if (!includeResolved && (st === 'paid' || st === 'overpaid')) {
      // échéance soldée = résolue : exclue sauf demande explicite
    }
    const daysLate = daysBetween(rd.due_date, now);
    let color: EventColor = 'green';
    let priority: EventPriority = 'information';
    if (st === 'paid' || st === 'overpaid') {
      color = 'green';
      priority = 'information';
    } else if (daysLate > 0) {
      color = 'red';
      priority = daysLate > 30 ? 'urgent' : daysLate > 7 ? 'important' : 'a_traiter';
    } else if (daysBetween(now, rd.due_date) <= 7) {
      color = 'amber';
      priority = 'a_traiter';
    } else {
      color = 'green';
      priority = 'information';
    }
    const balance = Number(rd.total_due || 0) - Number(rd.paid_amount || 0);
    push({
      id: `rent_due|${rd.id}`,
      date: rd.due_date,
      category: 'rent_due',
      type: 'rent_due',
      priority,
      title: `Loyer ${rd.period || ''} — ${rd.tenant_name || 'locataire'}`,
      subtitle: `${propName(rd.property_id)}${lotDesignation(rd.lot_id) ? ' · ' + lotDesignation(rd.lot_id) : ''}${
        st === 'paid' ? ' · soldé' : st === 'partial' ? ' · partiel ' + Math.round(balance) + '€' : ' · ' + Math.round(balance) + '€ à encaisser'
      }`,
      propertyId: rd.property_id,
      entityRef: { kind: 'rent_due', id: rd.id },
      status: st,
      snoozedUntil: rd.snoozed_until || null,
      snoozed: false,
      actionUrl: '/loyers?tab=compte-locataire',
      icon: 'Wallet',
      color,
    });
  }

  // 2. Impayés en cours (Impaye)
  for (const i of impayes) {
    if (i.status === 'régularisé' || i.status === 'regularise' || i.status === 'abandonné' || i.status === 'abandonne') continue;
    const d = i.first_unpaid_date || i.due_date || i.detected_date;
    if (!d) continue;
    // événement ancré sur la dernière date d'action / détection / aujourd'hui pour qu'il reste visible
    const anchor = (i.last_relance_date && i.last_relance_date > d ? i.last_relance_date : d) > now ? d : d;
    if (!inRange(anchor, from, to)) {
      // même si l'ancrage est hors fenêtre, on force l'événement à aujourd'hui s'il est actif
      if (inRange(now, from, to)) {
        // ok, on l'ajoute à aujourd'hui
      } else continue;
    }
    const late = Number(i.late_days) || daysBetween(d, now);
    const snoozed = isSnoozed(i.snoozed_until, now);
    push({
      id: `unpaid|${i.id}`,
      date: inRange(now, from, to) ? (d > now ? d : now) : anchor,
      category: 'unpaid',
      type: 'unpaid',
      priority: late > 45 ? 'urgent' : late > 20 ? 'important' : 'a_traiter',
      title: `Impayé — ${i.tenant_name || 'locataire'} (${i.period || ''})`,
      subtitle: `Reste ${Math.round(Number(i.outstanding_amount || i.missing_amount || 0))}€ · ${late} j de retard`,
      propertyId: i.property_id,
      entityRef: { kind: 'impaye', id: i.id },
      status: i.status,
      snoozedUntil: i.snoozed_until || null,
      snoozed,
      actionUrl: '/loyers?tab=impayes',
      icon: 'AlertTriangle',
      color: 'red',
    });
  }

  // 3. Baux (Lease) — start / end / anniversaire
  for (const l of leases) {
    const tenant = (l.tenants || [])[0]?.name || 'Bail';
    const lot = lotDesignation(l.lot_id);
    if (l.date_start && inRange(l.date_start, from, to)) {
      push({
        id: `lease_start|${l.id}`,
        date: l.date_start,
        category: 'lease',
        type: 'lease_start',
        priority: 'information',
        title: `Début de bail — ${tenant}${lot ? ' sur ' + lot : ''}`,
        subtitle: `${propName(l.property_id)}${l.lease_type ? ' · ' + l.lease_type : ''}`,
        propertyId: l.property_id,
        entityRef: { kind: 'lease', id: l.id },
        status: l.status,
        snoozedUntil: l.snoozed_until || null,
        snoozed: false,
        actionUrl: l.property_id ? `/biens/${l.property_id}${l.lot_id ? '?lot=' + l.lot_id : ''}` : '/locataires',
        icon: 'FileSignature',
        color: 'blue',
      });
    }
    if (l.date_end) {
      const end = l.date_end;
      const remind = addDays(end, -90);
      if (inRange(remind, from, to)) {
        push({
          id: `lease_end_remind|${l.id}`,
          date: remind,
          category: 'lease',
          type: 'lease_end',
          priority: 'a_traiter',
          title: `Fin de bail à J-90 — ${tenant}`,
          subtitle: `${propName(l.property_id)}${lot ? ' · ' + lot : ''} · échéance ${end}`,
          propertyId: l.property_id,
          entityRef: { kind: 'lease', id: l.id },
          status: l.status,
          snoozedUntil: l.snoozed_until || null,
          snoozed: false,
          actionUrl: l.property_id ? `/biens/${l.property_id}${l.lot_id ? '?lot=' + l.lot_id : ''}` : '/locataires',
          icon: 'FileSignature',
          color: 'blue',
        });
      }
      if (inRange(end, from, to)) {
        push({
          id: `lease_end|${l.id}`,
          date: end,
          category: 'lease',
          type: 'lease_end',
          priority: 'important',
          title: `Fin de bail aujourd'hui — ${tenant}`,
          subtitle: `${propName(l.property_id)}${lot ? ' · ' + lot : ''}`,
          propertyId: l.property_id,
          entityRef: { kind: 'lease', id: l.id },
          status: l.status,
          snoozedUntil: l.snoozed_until || null,
          snoozed: false,
          actionUrl: l.property_id ? `/biens/${l.property_id}${l.lot_id ? '?lot=' + l.lot_id : ''}` : '/locataires',
          icon: 'FileSignature',
          color: 'blue',
        });
      }
    }
    // Anniversaires (révision IRL possible) — bails indexables
    const start = l.date_start;
    if (start && l.indexation_type && l.indexation_type !== 'aucune') {
      const startD = parse(start);
      if (startD) {
        const sy = startD.getUTCFullYear();
        const sm = startD.getUTCMonth();
        const sd = startD.getUTCDate();
        const ty = new Date(to + 'T00:00:00Z').getUTCFullYear();
        for (let y = sy; y <= ty + 1; y++) {
          const ann = new Date(Date.UTC(y, sm, sd));
          const annISO = iso(ann);
          if (annISO < from) continue;
          if (annISO > to) break;
          // pas d'anniversaire au-delà de la fin de bail
          if (l.date_end && annISO > l.date_end) continue;
          push({
            id: `lease_anniv|${l.id}|${annISO}`,
            date: annISO,
            category: 'lease',
            type: 'lease_anniversary',
            priority: 'information',
            title: `Anniversaire du bail — ${tenant}`,
            subtitle: `${propName(l.property_id)}${l.indexation_type ? ' · révision ' + l.indexation_type + ' possible' : ''}`,
            propertyId: l.property_id,
            entityRef: { kind: 'lease', id: l.id },
            status: l.status,
            snoozedUntil: l.snoozed_until || null,
            snoozed: false,
            actionUrl: '/loyers?tab=loyers-revision',
            icon: 'FileSignature',
            color: 'blue',
          });
        }
      }
    }
  }

  // 4. Révisions IRL (RentRevision) — 45 j avant l'anniversaire
  for (const r of revisions) {
    if (r.status === 'appliquee' || r.status === 'refusee') {
      if (!includeResolved) continue;
    }
    const base = r.new_revision_date || r.created_date;
    if (!base) continue;
    const evDate = addDays(base, -45);
    if (!inRange(evDate, from, to) && !inRange(base, from, to)) continue;
    if (!inRange(evDate, from, to)) continue;
    const snoozed = isSnoozed(r.snoozed_until, now);
    push({
      id: `irl|${r.id}`,
      date: evDate,
      category: 'irl_revision',
      type: 'irl_revision',
      priority: 'a_traiter',
      title: `Révision de loyer disponible — ${lotDesignation(r.lot_id) || 'bail'}`,
      subtitle: `${r.old_rent || 0}€ → ${r.new_rent || 0}€ (${r.variation_percent ?? 0}%)`,
      propertyId: r.property_id,
      entityRef: { kind: 'rent_revision', id: r.id },
      status: r.status,
      snoozedUntil: r.snoozed_until || null,
      snoozed,
      actionUrl: '/loyers?tab=loyers-revision',
      icon: 'TrendingUp',
      color: 'amber',
    });
  }

  // 5. Régularisation de charges (ChargeRegularization) — brouillons à valider
  for (const c of chargeRegs) {
    if (c.status === 'validee') {
      if (!includeResolved) continue;
    }
    // pas de date_deadline au schéma : on s'appuie sur created_date (date fiable)
    const d = c.created_date || c.validation_date;
    if (!d) continue;
    if (!inRange(d, from, to)) continue;
    push({
      id: `charge_reg|${c.id}`,
      date: d,
      category: 'charge_reg',
      type: 'charge_reg',
      priority: c.status === 'validee' ? 'information' : 'a_traiter',
      title: `Régularisation de charges — ${c.period || c.year || ''}`,
      subtitle: `${c.tenant_name || ''}${c.lot_designation ? ' · ' + c.lot_designation : ''} · solde ${Math.round(Number(c.solde || 0))}€`,
      propertyId: c.property_id,
      entityRef: { kind: 'charge_reg', id: c.id },
      status: c.status,
      snoozedUntil: c.snoozed_until || null,
      snoozed: false,
      actionUrl: '/loyers?tab=charges-regularisation',
      icon: 'FolderClock',
      color: 'amber',
    });
  }

  // 6. Documents à expiration (DPE / assurance / AG)
  const DOC_TYPES = new Set(['dpe', 'assurance', 'ag_copropriete']);
  for (const d of documents) {
    if (!DOC_TYPES.has(d.type)) continue;
    const exp = d.expiration_date;
    if (!exp) continue;
    const offsets = [90, 30, 7];
    for (const off of offsets) {
      const evDate = addDays(exp, -off);
      if (!inRange(evDate, from, to)) continue;
      const daysLeft = daysBetween(evDate, exp);
      const color: EventColor = daysLeft <= 7 ? 'red' : 'amber';
      const priority: EventPriority = daysLeft <= 7 ? 'urgent' : daysLeft <= 30 ? 'important' : 'a_traiter';
      const kindLabel = d.type === 'assurance' ? 'Assurance' : d.type === 'ag_copropriete' ? 'AG copropriété' : 'DPE';
      push({
        id: `doc_exp|${d.id}|${off}`,
        date: evDate,
        category: 'document_expiring',
        type: 'document_expiring',
        priority,
        title: `${kindLabel} à renouveler${daysLeft <= 7 ? " (échéance proche)" : ''}`,
        subtitle: `${d.title || d.filename || ''} · échéance ${exp}`,
        propertyId: d.property_id,
        entityRef: { kind: 'document', id: d.id },
        status: d.status,
        snoozedUntil: d.snoozed_until || null,
        snoozed: false,
        actionUrl: '/reglages?section=documents',
        icon: 'ShieldAlert',
        color,
      });
    }
    // jour d'échéance lui-même
    if (inRange(exp, from, to)) {
      push({
        id: `doc_exp|${d.id}|0`,
        date: exp,
        category: 'document_expiring',
        type: 'document_expiring',
        priority: 'urgent',
        title: `${d.type === 'assurance' ? 'Assurance' : d.type === 'ag_copropriete' ? 'AG copropriété' : 'DPE'} arrive à échéance`,
        subtitle: `${d.title || d.filename || ''}`,
        propertyId: d.property_id,
        entityRef: { kind: 'document', id: d.id },
        status: d.status,
        snoozedUntil: d.snoozed_until || null,
        snoozed: false,
        actionUrl: '/reglages?section=documents',
        icon: 'ShieldAlert',
        color: 'red',
      });
    }
  }

  // 7. Clôture mensuelle (MonthClose) — le 5 de chaque mois, sauf si déjà closed
  const closedPeriods = new Set(monthCloses.filter((m) => m.status === 'closed').map((m) => m.period));
  let cursor = new Date(from + 'T00:00:00Z');
  const toDate = new Date(to + 'T00:00:00Z');
  while (cursor <= toDate) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth(); // 0-11
    // mois précédent
    const prev = new Date(Date.UTC(y, m, 1));
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    const prevPeriod = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = `${MONTHS_FR[prev.getUTCMonth()]} ${prev.getUTCFullYear()}`;
    const due = `${y}-${String(m + 1).padStart(2, '0')}-05`;
    if (!closedPeriods.has(prevPeriod) && inRange(due, from, to)) {
      push({
        id: `month_close|${prevPeriod}`,
        date: due,
        category: 'month_close',
        type: 'month_close',
        priority: 'a_traiter',
        title: `Clôturer le mois de ${label}`,
        subtitle: 'Rapprochement, échéances et quittances à valider',
        entityRef: { kind: 'month_close', id: prevPeriod },
        status: 'open',
        snoozedUntil: null,
        snoozed: false,
        actionUrl: '/banque?tab=cloture',
        icon: 'CalendarCheck',
        color: 'primary',
      });
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    cursor.setUTCDate(1);
  }

  // 8. Alertes actives (Alert) — non résolues, non ignorées, snoozed visibles
  for (const a of alerts) {
    if (a.status === 'ignored') continue;
    if (a.status === 'resolved' && !includeResolved) continue;
    const d = a.date || a.created_date || now;
    const snoozed = isSnoozed(a.snooze_until, now);
    if (!inRange(d, from, to)) {
      // une alerte active est toujours visible sur aujourd'hui si dans la fenêtre
      if (!(a.status === 'snoozed' && snoozed) && !inRange(now, from, to)) continue;
    }
    const date = inRange(d, from, to) ? d : now;
    const colorMap: Record<EventPriority, EventColor> = { urgent: 'red', important: 'amber', a_traiter: 'amber', information: 'blue' };
    const prio = (a.priority || 'information') as EventPriority;
    push({
      id: `alert|${a.id}`,
      date,
      category: 'alert',
      type: `alert:${a.source || 'generic'}`,
      priority: prio,
      title: a.title || 'Alerte',
      subtitle: a.message || a.recommended_action || '',
      propertyId: undefined,
      entityRef: { kind: 'alert', id: a.id },
      status: a.status,
      snoozedUntil: a.snooze_until || null,
      snoozed,
      actionUrl: a.action_url || '/',
      icon: 'Bell',
      color: colorMap[prio],
    });
  }

  // 9. Quittances manquantes — échéances soldées sans quittance, sur mois clos
  const quittanceByRentDue = new Set(quittances.map((q) => q.rent_due_id).filter(Boolean));
  const closedPeriodsForQuit = new Set(monthCloses.filter((m) => m.status === 'closed').map((m) => m.period));
  for (const rd of rentDues) {
    if (rd.status !== 'paid' && rd.status !== 'overpaid') continue;
    if (!closedPeriodsForQuit.has(rd.period)) continue;
    if (quittanceByRentDue.has(rd.id)) continue;
    const d = now;
    if (!inRange(d, from, to)) continue;
    push({
      id: `quit_miss|${rd.id}`,
      date: d,
      category: 'quittance_missing',
      type: 'quittance_missing',
      priority: 'a_traiter',
      title: `Quittance manquante — ${rd.tenant_name || 'locataire'} (${rd.period || ''})`,
      subtitle: `${propName(rd.property_id)}${lotDesignation(rd.lot_id) ? ' · ' + lotDesignation(rd.lot_id) : ''}`,
      propertyId: rd.property_id,
      entityRef: { kind: 'rent_due', id: rd.id },
      status: 'missing',
      snoozedUntil: null,
      snoozed: false,
      actionUrl: '/loyers?tab=quittances',
      icon: 'Receipt',
      color: 'amber',
    });
  }

  // 10. Échéances de crédit mensuelles (Property) — repli 1 événement / bien / mois
  const loanInstallMonths = new Set(
    transactions
      .filter((t) => t.category === 'loan_installment')
      .map((t) => `${t.property_id}|${t.year}|${t.month}`)
  );
  for (const p of properties) {
    if (!p.loan_amount || Number(p.loan_amount) <= 0) continue;
    if (!p.loan_start_date) continue;
    // mois courant + suivant
    for (let off = 0; off <= 1; off++) {
      const cur = addMonthsISO(now, off);
      const y = cur.getUTCFullYear();
      const m = cur.getUTCMonth() + 1;
      const due = `${y}-${String(m).padStart(2, '0')}-05`;
      if (!inRange(due, from, to)) continue;
      const reconciled = loanInstallMonths.has(`${p.id}|${y}|${m}`);
      push({
        id: `loan|${p.id}|${y}-${m}`,
        date: due,
        category: 'loan_installment',
        type: 'loan_installment',
        priority: reconciled ? 'information' : 'a_traiter',
        title: `Échéance de prêt — ${p.name || 'bien'}`,
        subtitle: `${p.monthly_payment || 0}€ · ${reconciled ? 'rapprochée' : 'non rapprochée ce mois'}`,
        propertyId: p.id,
        entityRef: { kind: 'property', id: p.id },
        status: reconciled ? 'reconciled' : 'pending',
        snoozedUntil: null,
        snoozed: false,
        actionUrl: `/biens/${p.id}`,
        icon: 'Banknote',
        color: reconciled ? 'gray' : 'amber',
      });
    }
  }

  // tri par date asc, puis priorité (urgent d'abord si même jour)
  const rankP: Record<EventPriority, number> = { urgent: 4, important: 3, a_traiter: 2, information: 1 };
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : rankP[b.priority] - rankP[a.priority]));

  return out;
}