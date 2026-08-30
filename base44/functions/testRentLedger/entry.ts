import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { R2 } from '../../shared/rentLedger.ts';

function assert(cond: any, label: string, errs: string[]) {
  if (!cond) errs.push(`ÉCHEC: ${label}`);
}

/**
 * Tests de non-régression du moteur de ledger locatif.
 * Chaque scénario crée son propre bail + ses échéances, enregistre des
 * paiements via la fonction `recordPayment`, puis vérifie les statuts/balances.
 *
 * Scénarios obligatoires :
 *  1. paiement total
 *  2. paiement partiel
 *  3. CAF + complément locataire
 *  4. paiement en avance
 *  5. paiement en retard
 *  6. paiement couvrant plusieurs mois
 *  7. trop-perçu
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }
    const svc = base44.asServiceRole;
    const owner = user.email;
    const errs: string[] = [];

    const prop = await svc.entities.Property.create({
      owner_id: owner, is_demo: true, name: 'Immeuble-Ledger-Test',
      category: 'Immeuble', holding_structure: 'En propre', tax_regime: 'Location nue (revenus fonciers)',
    });
    const lot = await svc.entities.Lot.create({
      owner_id: owner, is_demo: true, property_id: prop.id, designation: 'Lot-Ledger-Test', typology: 'T2', surface: 50,
    });

    const cleanup: { payments: string[]; dues: string[]; leases: string[] } = { payments: [], dues: [], leases: [] };

    // Crée un bail isolé pour un scénario + helpers de paiement/vérif.
    async function scenario() {
      const leaseStart = '2026-01-01';
      const lease = await svc.entities.Lease.create({
        owner_id: owner, is_demo: true, property_id: prop.id, lot_id: lot.id,
        lease_type: 'Vide-Nu', date_start: leaseStart,
        rent_excluding_charges: 600, charges: 50, deposit: 650, due_day: 5, status: 'actif',
        tenants: [{ name: 'Test Ledger', email: 'ledger@test.com' }],
      });
      cleanup.leases.push(lease.id);
      const TOTAL = 650;
      async function mkDue(year: number, month: number) {
        const period = `${year}-${String(month).padStart(2, '0')}`;
        const d = await svc.entities.RentDue.create({
          owner_id: owner, is_demo: true, lease_id: lease.id, property_id: prop.id, lot_id: lot.id,
          year, month, period, due_date: `${year}-${String(month).padStart(2, '0')}-05`,
          rent_excluding_charges: 600, charges: 50, additional_amount: 0, total_due: TOTAL,
          paid_amount: 0, balance: TOTAL, status: 'unpaid', tenant_name: 'Test Ledger',
        });
        cleanup.dues.push(d.id);
        return d;
      }
      async function pay(payload: any) {
        const res = await base44.functions.invoke('recordPayment', { lease_id: lease.id, ...payload });
        const data = (res && res.data) || {};
        if (data.payment_id) cleanup.payments.push(data.payment_id);
        return data;
      }
      async function getDue(id: string) { return await svc.entities.RentDue.get(id); }
      return { lease, mkDue, pay, getDue, TOTAL };
    }

    // 1. Paiement total
    {
      const s = await scenario();
      const d = await s.mkDue(2026, 8);
      await s.pay({ date: '2026-08-05', amount: 650, payer_type: 'tenant', method: 'virement' });
      const dd = await s.getDue(d.id);
      assert(dd.status === 'paid', 'paiement total → paid', errs);
      assert(R2(dd.balance) === 0, 'paiement total → balance 0', errs);
      assert(R2(dd.paid_amount) === 650, 'paiement total → paid_amount 650', errs);
    }

    // 2. Paiement partiel
    {
      const s = await scenario();
      const d = await s.mkDue(2026, 9);
      await s.pay({ date: '2026-09-05', amount: 400, payer_type: 'tenant', method: 'virement' });
      const dd = await s.getDue(d.id);
      assert(dd.status === 'partial', 'paiement partiel → partial', errs);
      assert(R2(dd.balance) === 250, 'paiement partiel → balance 250', errs);
    }

    // 3. CAF + complément locataire
    {
      const s = await scenario();
      const d = await s.mkDue(2026, 10);
      await s.pay({ date: '2026-10-05', amount: 200, payer_type: 'caf', payer_name: 'CAF', method: 'caf' });
      let dd = await s.getDue(d.id);
      assert(dd.status === 'partial', 'CAF: après CAF → partial', errs);
      await s.pay({ date: '2026-10-05', amount: 450, payer_type: 'tenant', method: 'virement' });
      dd = await s.getDue(d.id);
      assert(dd.status === 'paid', 'CAF+complément → paid', errs);
      assert(R2(dd.paid_amount) === 650, 'CAF+complément → paid_amount 650', errs);
    }

    // 4. Paiement en avance
    {
      const s = await scenario();
      const d = await s.mkDue(2026, 11);
      assert(d.due_date > '2026-08-24', 'avance: échéance future', errs);
      await s.pay({ date: '2026-08-20', amount: 650, payer_type: 'tenant', method: 'virement' });
      const dd = await s.getDue(d.id);
      assert(dd.status === 'paid', 'avance → paid', errs);
    }

    // 5. Paiement en retard
    {
      const s = await scenario();
      const d = await s.mkDue(2026, 7);
      assert(d.due_date < '2026-08-24', 'retard: échéance passée', errs);
      assert(d.status === 'unpaid', 'retard: échéance initialement unpaid', errs);
      await s.pay({ date: '2026-08-24', amount: 650, payer_type: 'tenant', method: 'virement' });
      const dd = await s.getDue(d.id);
      assert(dd.status === 'paid', 'retard → paid après paiement tardif', errs);
    }

    // 6. Paiement couvrant plusieurs mois
    {
      const s = await scenario();
      const d1 = await s.mkDue(2026, 12);
      const d2 = await s.mkDue(2027, 1);
      const r = await s.pay({ date: '2026-12-05', amount: 1300, payer_type: 'tenant', method: 'virement' });
      const dd1 = await s.getDue(d1.id);
      const dd2 = await s.getDue(d2.id);
      assert(dd1.status === 'paid' && dd2.status === 'paid', 'plusieurs mois: 2 échéances paid', errs);
      assert((r.allocations || []).length === 2, 'plusieurs mois: 2 affectations', errs);
      assert(R2(r.unallocated) === 0, 'plusieurs mois: unallocated 0', errs);
    }

    // 7. Trop-perçu
    {
      const s = await scenario();
      const d = await s.mkDue(2027, 2);
      const r = await s.pay({
        date: '2027-02-05', amount: 700, payer_type: 'tenant', method: 'virement',
        allocations: [{ rent_due_id: d.id, amount: 700 }],
      });
      const dd = await s.getDue(d.id);
      assert(dd.status === 'overpaid', 'trop-perçu → overpaid', errs);
      assert(R2(dd.balance) === -50, 'trop-perçu → balance -50', errs);
      assert(R2(r.unallocated) === 0, 'trop-perçu → unallocated 0', errs);
    }

    // Nettoyage de toutes les données créées pour les tests.
    for (const id of cleanup.payments) { try { await svc.entities.Payment.delete(id); } catch (_e) {} }
    for (const id of cleanup.dues) { try { await svc.entities.RentDue.delete(id); } catch (_e) {} }
    for (const id of cleanup.leases) { try { await svc.entities.Lease.delete(id); } catch (_e) {} }
    try { await svc.entities.Lot.delete(lot.id); } catch (_e) {}
    try { await svc.entities.Property.delete(prop.id); } catch (_e) {}

    return Response.json({
      ok: errs.length === 0,
      passed: 7 - errs.length,
      total: 7,
      errors: errs,
      tested: ['paiement total', 'paiement partiel', 'CAF + complément', 'paiement en avance', 'paiement en retard', 'paiement multi-mois', 'trop-perçu'],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}