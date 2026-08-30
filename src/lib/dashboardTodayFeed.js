/**
 * dashboardTodayFeed — fusionne 3 sources pour la Zone 2 "Aujourd'hui".
 *
 *   1. computeAttentionQueue  — items {level, domain, reason, linked_label, action_url}
 *   2. PersonalReminder       — rappels personnels dus (due_date <= today, non done)
 *   3. calendarEvents         — événements du jour, PRIVÉS des types déjà couverts
 *                               par l'attention queue (impaye, rent_due, month_close,
 *                               alert, irl_revision, document_expiring)
 *
 *  urgency_score :
 *    ERROR: 100, NEEDS_ACTION: 60, personal_reminder_due_today: 40,
 *    NEEDS_CONFIRMATION: 30, calendar_event_today: 20
 *
 *  Tri : urgency_score DESC, puis date ASC.
 *
 *  Retour : { items, counts }
 *    item normalisé : { id, kind, title, subtitle, urgency, urgencyKey,
 *                       iconKind, domain, action_url, date, raw }
 */
export const URGENCY = {
  error: { score: 100, key: 'error', border: 'border-l-rose-500', icon: 'text-rose-600' },
  action: { score: 60, key: 'action', border: 'border-l-amber-500', icon: 'text-amber-600' },
  reminder: { score: 40, key: 'reminder', border: 'border-l-blue-500', icon: 'text-blue-600' },
  confirmation: { score: 30, key: 'confirmation', border: 'border-l-indigo-500', icon: 'text-indigo-600' },
  calendar: { score: 20, key: 'calendar', border: 'border-l-slate-300', icon: 'text-slate-500' },
};

// Catégories calendrier déjà couvertes par l'attention queue -> exclues.
const CALENDAR_EXCLUDED = new Set([
  'impaye', 'rent_due', 'month_close', 'alert', 'irl_revision', 'document_expiring',
]);

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function buildTodayFeed({ attention, reminders = [], calendarEvents = [], today } = {}) {
  const t = today || todayISO();
  const items = [];

  // 1. Attention queue (source dominante).
  for (const v of attention || []) {
    const level = v.level || 'NEEDS_ACTION';
    let u;
    if (level === 'ERROR') u = URGENCY.error;
    else if (level === 'NEEDS_ACTION') u = URGENCY.action;
    else u = URGENCY.confirmation;
    items.push({
      id: `q|${v.domain || 'alert'}|${v.linked_id || v.id || Math.random()}`,
      kind: 'queue',
      title: v.reason || v.linked_label || 'À traiter',
      subtitle: v.linked_label && v.reason ? v.linked_label : '',
      urgency: u.score,
      urgencyKey: u.key,
      iconKind: 'queue',
      domain: v.domain,
      action_url: v.action_url,
      date: t,
      raw: v,
    });
  }

  // 2. Rappels personnels dus aujourd'hui (ou en retard, non done/snoozed passé).
  for (const r of reminders) {
    if (r.status === 'done') continue;
    if (r.status === 'snoozed' && r.snoozed_until && r.snoozed_until > t) continue;
    const due = r.due_date || t;
    items.push({
      id: `r|${r.id}`,
      kind: 'reminder',
      title: r.title,
      subtitle: r.note || (r.due_date ? `Échéance ${r.due_date}` : ''),
      urgency: URGENCY.reminder.score,
      urgencyKey: URGENCY.reminder.key,
      iconKind: 'reminder',
      domain: 'reminder',
      action_url: null,
      date: due,
      raw: r,
    });
  }

  // 3. Calendrier — événements du jour, hors types couverts par la queue.
  for (const e of calendarEvents || []) {
    if (e.date !== t) continue;
    if (CALENDAR_EXCLUDED.has(e.category)) continue;
    items.push({
      id: `c|${e.id}`,
      kind: 'calendar',
      title: e.title,
      subtitle: e.subtitle,
      urgency: URGENCY.calendar.score,
      urgencyKey: URGENCY.calendar.key,
      iconKind: 'calendar',
      domain: e.category,
      icon: e.icon,
      action_url: e.actionUrl,
      date: e.date,
      raw: e,
    });
  }

  items.sort((a, b) => (b.urgency - a.urgency) || String(a.date).localeCompare(String(b.date)));

  const counts = {
    total: items.length,
    urgent: items.filter((i) => i.urgency >= 100).length,
    action: items.filter((i) => i.urgency === 60).length,
    reminders: items.filter((i) => i.kind === 'reminder').length,
    calendar: items.filter((i) => i.kind === 'calendar').length,
    queue: items.filter((i) => i.kind === 'queue').length,
  };
  return { items, counts };
}