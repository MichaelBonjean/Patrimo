import { describe, it, expect } from 'vitest';
import { buildCalendarEvents } from '../../base44/shared/calendarEngine.ts';

const NOW = '2026-01-10';
const FROM = '2025-01-10'; // J-365
const TO = '2026-04-10'; // J+90

function baseData(over = {}) {
  return {
    properties: [{ id: 'p1', name: 'Studio Nord', loan_amount: 100000, loan_start_date: '2024-01-05', monthly_payment: 600 }],
    lots: [{ id: 'l1', property_id: 'p1', designation: 'Appart RDC', dpe_class: 'F' }],
    leases: [{
      id: 'le1', property_id: 'p1', lot_id: 'l1',
      date_start: '2024-02-01', date_end: '2027-02-01',
      status: 'actif', lease_type: 'Vide-Nu', indexation_type: 'IRL',
      tenants: [{ name: 'M. Dupont' }],
    }],
    rentDues: [
      { id: 'rd1', lease_id: 'le1', property_id: 'p1', lot_id: 'l1', year: 2026, month: 1, period: '2026-01', due_date: '2026-01-05', total_due: 700, paid_amount: 0, status: 'unpaid', tenant_name: 'M. Dupont' },
      { id: 'rd2', lease_id: 'le1', property_id: 'p1', lot_id: 'l1', year: 2025, month: 12, period: '2025-12', due_date: '2025-12-05', total_due: 700, paid_amount: 700, status: 'paid', tenant_name: 'M. Dupont' },
    ],
    impayes: [{ id: 'im1', rent_due_id: 'rd1', lease_id: 'le1', lot_id: 'l1', property_id: 'p1', tenant_name: 'M. Dupont', period: '2025-12', outstanding_amount: 700, late_days: 40, status: 'echeance_impayee', first_unpaid_date: '2025-12-05' }],
    quittances: [],
    rentRevisions: [{ id: 'rr1', lease_id: 'le1', lot_id: 'l1', property_id: 'p1', old_rent: 680, new_rent: 700, variation_percent: 2.9, status: 'proposition', new_revision_date: '2026-02-01', created_date: '2026-01-01' }],
    chargeRegs: [{ id: 'cr1', lease_id: 'le1', lot_id: 'l1', property_id: 'p1', year: 2025, period: '2025', tenant_name: 'M. Dupont', lot_designation: 'Appart RDC', solde: 120, status: 'draft', created_date: '2026-01-03' }],
    monthCloses: [{ id: 'mc1', period: '2025-12', status: 'closed' }],
    documents: [{ id: 'd1', type: 'assurance', expiration_date: '2026-01-20', title: 'PNO AXA', status: 'valide' }],
    transactions: [],
    alerts: [
      { id: 'a1', source: 'loyer_impaye', status: 'active', priority: 'important', date: '2026-01-08', title: 'Loyer impayé — M. Dupont', message: 'Reste 700€', action_url: '/loyers', snooze_until: null },
      { id: 'a2', source: 'dpe', status: 'snoozed', priority: 'information', date: '2026-01-08', title: 'DPE classe F', snooze_until: '2026-01-15' },
    ],
    ...over,
  };
}

const OPTS = { from: FROM, to: TO, now: NOW };

describe('calendarEngine — agrégation consolidée', () => {
  it('agrège les 10 catégories de sources', () => {
    const events = buildCalendarEvents(baseData(), OPTS);
    const cats = new Set(events.map((e) => e.category));
    expect(cats.has('rent_due')).toBe(true);
    expect(cats.has('unpaid')).toBe(true);
    expect(cats.has('lease')).toBe(true); // anniversaire
    expect(cats.has('irl_revision')).toBe(true);
    expect(cats.has('charge_reg')).toBe(true);
    expect(cats.has('document_expiring')).toBe(true);
    expect(cats.has('month_close')).toBe(true);
    expect(cats.has('alert')).toBe(true);
    expect(cats.has('quittance_missing')).toBe(true); // rd2 soldé, 2025-12 clos, pas de quittance
    expect(cats.has('loan_installment')).toBe(true);
  });

  it('respecte la fenêtre from/to (exclut les événements hors plage)', () => {
    const events = buildCalendarEvents(baseData(), { from: FROM, to: '2025-12-31', now: NOW });
    // rd1 (2026-01-05) hors fenêtre → absent
    expect(events.some((e) => e.id === 'rent_due|rd1')).toBe(false);
  });

  it('exclut les événements résolus sauf si includeResolved=true', () => {
    const data = baseData({ alerts: [baseData().alerts[0], { id: 'aR', source: 'assurance', status: 'resolved', priority: 'information', date: '2026-01-09', title: 'Assurance renouvelée' }] });
    const def = buildCalendarEvents(data, OPTS);
    expect(def.some((e) => e.id === 'alert|aR')).toBe(false);
    const withResolved = buildCalendarEvents(data, { ...OPTS, includeResolved: true });
    expect(withResolved.some((e) => e.id === 'alert|aR')).toBe(true);
  });

  it("respecte snoozedUntil : un événement snoozé jusqu'au 15/01 est signalé snoozed et masqué si includeSnoozed=false", () => {
    const ev = buildCalendarEvents(baseData(), OPTS);
    const a2 = ev.find((e) => e.id === 'alert|a2');
    expect(a2).toBeTruthy();
    expect(a2.snoozed).toBe(true); // 2026-01-15 > NOW (2026-01-10)
    expect(a2.snoozedUntil).toBe('2026-01-15');
    const hidden = buildCalendarEvents(baseData(), { ...OPTS, includeSnoozed: false });
    expect(hidden.some((e) => e.id === 'alert|a2')).toBe(false);
  });

  it('trie par date ascendante', () => {
    const ev = buildCalendarEvents(baseData(), OPTS);
    for (let i = 1; i < ev.length; i++) {
      expect(ev[i].date >= ev[i - 1].date).toBe(true);
    }
  });
});