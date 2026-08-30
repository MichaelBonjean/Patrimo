import { describe, it, expect } from 'vitest';
import { allocateFifo, recalcAllDues, statusFor } from '../../base44/shared/rentLedger.ts';

// Intégration : un paiement → affectation FIFO sur les échéances → recalcul des statuts.
describe('INTÉGRATION — paiement → échéance(s)', () => {
  it('un paiement couvre la plus ancienne échéance puis la suivante (FIFO)', () => {
    const dues = [
      { id: 'd1', total_due: 800, paid_amount: 0, balance: 800, status: 'unpaid', period: '2024-01' },
      { id: 'd2', total_due: 800, paid_amount: 0, balance: 800, status: 'unpaid', period: '2024-02' },
    ];
    const { allocations } = allocateFifo(dues, 1000);
    expect(allocations).toEqual([
      { rent_due_id: 'd1', amount: 800 },
      { rent_due_id: 'd2', amount: 200 },
    ]);
    const payments = [{ allocations, unallocated: 0 }];
    const out = recalcAllDues(dues, payments);
    expect(out[0].status).toBe('paid');
    expect(out[1].status).toBe('partial');
  });

  it('paiement CAF partiel + paiement locataire → échéance soldée', () => {
    const dues = [{ id: 'd1', total_due: 700, paid_amount: 0, balance: 700, status: 'unpaid', period: '2024-01' }];
    const payments = [
      { allocations: [{ rent_due_id: 'd1', amount: 300 }], payer_type: 'caf' }, // CAF
      { allocations: [{ rent_due_id: 'd1', amount: 400 }], payer_type: 'tenant' }, // locataire
    ];
    const [out] = recalcAllDues(dues, payments);
    expect(out.paid_amount).toBe(700);
    expect(out.balance).toBe(0);
    expect(out.status).toBe('paid');
  });

  it('trop-perçu : l’excédent reste en unallocated (crédit), pas sur l’échéance', () => {
    const dues = [{ id: 'd1', total_due: 700, paid_amount: 0, balance: 700, status: 'unpaid', period: '2024-01' }];
    const r = allocateFifo(dues, 1000);
    expect(r.unallocated).toBe(300);
    const out = recalcAllDues(dues, [{ allocations: r.allocations }]);
    expect(out[0].status).toBe('paid');
    expect(out[0].paid_amount).toBe(700);
  });

  it('statuts cohérents avant/après sur plusieurs échéances', () => {
    const dues = [
      { id: 'd1', total_due: 600, paid_amount: 0, balance: 600, status: 'unpaid', period: '2024-01' },
      { id: 'd2', total_due: 600, paid_amount: 0, balance: 600, status: 'unpaid', period: '2024-02' },
      { id: 'd3', total_due: 600, paid_amount: 0, balance: 600, status: 'unpaid', period: '2024-03' },
    ];
    const { allocations, unallocated } = allocateFifo(dues, 1500);
    expect(unallocated).toBe(0);
    const out = recalcAllDues(dues, [{ allocations }]);
    expect(out.map((d) => d.status)).toEqual(['paid', 'paid', 'partial']);
  });
});