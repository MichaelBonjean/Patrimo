import { describe, it, expect } from 'vitest';
import {
  statusFor,
  recalcDue,
  allocateFifo,
  allocatedTo,
  recalcAllDues,
  totalOutstanding,
  totalCredit,
  R2,
} from '../../base44/shared/rentLedger.ts';

const dues = (specs) =>
  specs.map((s) => ({
    id: s.id,
    total_due: s.total,
    paid_amount: s.paid || 0,
    balance: R2(s.total - (s.paid || 0)),
    status: statusFor(s.total, s.paid || 0),
    period: s.period || '2024-01',
  }));

describe('rentLedger — loyers, échéances, paiements', () => {
  it('statusFor : unpaid / partial / paid / overpaid', () => {
    expect(statusFor(1000, 0)).toBe('unpaid');
    expect(statusFor(1000, 400)).toBe('partial');
    expect(statusFor(1000, 1000)).toBe('paid');
    expect(statusFor(1000, 1200)).toBe('overpaid');
  });

  it('recalcDue : recalcule paid_amount, balance, status', () => {
    const d = recalcDue({ id: 'd1', total_due: 1000, paid_amount: 0 }, 600);
    expect(d.status).toBe('partial');
    expect(d.balance).toBe(400);
    expect(d.paid_amount).toBe(600);
  });

  it('allocateFifo : FIFO sur les plus anciennes d’abord, plafonné au solde', () => {
    const d = dues([
      { id: 'd1', total: 800, paid: 0, period: '2024-01' },
      { id: 'd2', total: 700, paid: 200, period: '2024-02' },
      { id: 'd3', total: 600, paid: 600, period: '2024-03' }, // soldée → ignorée
    ]);
    const r = allocateFifo(d, 900);
    // d1 reçoit 800 (solde 800), reste 100 → d2 reçoit 100 (solde 500)
    expect(r.allocations).toEqual([
      { rent_due_id: 'd1', amount: 800 },
      { rent_due_id: 'd2', amount: 100 },
    ]);
    expect(r.unallocated).toBe(0);
  });

  it('allocateFifo : l’excédent reste en unallocated (pas de trop-perçu automatique)', () => {
    const d = dues([{ id: 'd1', total: 500, paid: 0, period: '2024-01' }]);
    const r = allocateFifo(d, 800);
    expect(r.allocations).toEqual([{ rent_due_id: 'd1', amount: 500 }]);
    expect(r.unallocated).toBe(300);
  });

  it('allocatedTo : somme des allocations visant une échéance', () => {
    const payments = [
      { allocations: [{ rent_due_id: 'd1', amount: 400 }, { rent_due_id: 'd2', amount: 100 }] },
      { allocations: [{ rent_due_id: 'd1', amount: 600 }] },
    ];
    expect(allocatedTo('d1', payments)).toBe(1000);
    expect(allocatedTo('d2', payments)).toBe(100);
  });

  it('recalcAllDues : recalcule toutes les échéances à partir des paiements', () => {
    const d = dues([
      { id: 'd1', total: 1000, period: '2024-01' },
      { id: 'd2', total: 800, period: '2024-02' },
    ]);
    const payments = [{ allocations: [{ rent_due_id: 'd1', amount: 700 }, { rent_due_id: 'd2', amount: 800 }] }];
    const out = recalcAllDues(d, payments);
    expect(out[0]).toMatchObject({ status: 'partial', paid_amount: 700, balance: 300 });
    expect(out[1]).toMatchObject({ status: 'paid', paid_amount: 800, balance: 0 });
  });

  it('totalOutstanding : somme des balances positives', () => {
    const d = dues([
      { id: 'd1', total: 1000, paid: 700, period: '2024-01' }, // balance 300
      { id: 'd2', total: 800, paid: 1000, period: '2024-02' }, // balance -200 (crédit)
    ]);
    expect(totalOutstanding(d)).toBe(300);
  });

  it('totalCredit : trop-perçus + paiements non affectés', () => {
    const d = dues([{ id: 'd1', total: 800, paid: 1000, period: '2024-01' }]); // trop-perçu 200
    const payments = [{ unallocated: 150 }];
    expect(totalCredit(d, payments)).toBeCloseTo(350, 0);
  });

  it('un paiement réparti sur plusieurs échéances (many-to-many)', () => {
    const d = dues([
      { id: 'd1', total: 600, period: '2024-01' },
      { id: 'd2', total: 600, period: '2024-02' },
    ]);
    const r = allocateFifo(d, 1000);
    expect(r.allocations.reduce((s, a) => s + a.amount, 0)).toBe(1000);
    const out = recalcAllDues(d, [{ allocations: r.allocations }]);
    expect(out[0].status).toBe('paid');
    expect(out[1].status).toBe('partial');
  });
});