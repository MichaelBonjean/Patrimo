import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { R2 } from '../../shared/rentLedger.ts';
import { generateQuittanceFor } from '../../shared/quittanceEngine.ts';

/**
 * Tests du moteur de quittances fiabilisé (generé depuis le compte locataire
 * réel : RentDue -> Payments).
 *
 * Scénarios :
 *  1. paiement total  -> quittance 'full', balance = 0, payment_date réel
 *  2. paiement partiel -> reçu 'partial', solde restant positif
 *  3. aucun paiement -> refus (reason='unpaid', 409)
 *  4. trop-perçu -> quittance 'full' (paid > total_dû), balance < 0
 *  5. immutabilité : après génération, modifier le bail ne change PAS le
 *     snapshot de la quittance existante (renvoyée à l'identique).
 *
 * Nettoie toutes les données de test créées.
 */

const P = (n: number) => n.toFixed(2);

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'user') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const svc = base44.asServiceRole;

  const errors: string[] = [];
  const created: string[] = []; // ids à nettoyer
  const tryAssert = (name: string, fn: () => void) => {
    try { fn(); } catch (e) { errors.push(`${name}: ${(e as any).message || e}`); }
  };

  const cleanup: Array<() => Promise<void>> = [];
  const reg = (entity: any, id: string) => cleanup.push(() => entity.delete(id).catch(() => {}));

  try {
    // --- Setupbien / lot / bail ---
    const prop = await svc.entities.Property.create({
      owner_id: user.email, is_demo: true, name: 'ZQ-TEST-QUIT',
      category: 'Immeuble', holding_structure: 'En propre', tax_regime: 'Location nue (revenus fonciers)',
    });
    reg(svc.entities.Property, prop.id);
    const lot = await svc.entities.Lot.create({
      owner_id: user.email, is_demo: true, property_id: prop.id, designation: 'Lot-Q-1', typology: 'T2', surface: 50,
    });
    reg(svc.entities.Lot, lot.id);
    const lease = await svc.entities.Lease.create({
      owner_id: user.email, is_demo: true, property_id: prop.id, lot_id: lot.id, lease_type: 'Vide-Nu',
      date_start: '2026-01-01', rent_excluding_charges: 700, charges: 50, deposit: 750, due_day: 5, status: 'actif',
      tenants: [{ name: 'Loc Test' }],
    });
    reg(svc.entities.Lease, lease.id);

    const makeDue = async (y: number, m: number) => {
      const d = await svc.entities.RentDue.create({
        owner_id: user.email, is_demo: true, lease_id: lease.id, property_id: prop.id, lot_id: lot.id,
        year: y, month: m, period: `${y}-${String(m).padStart(2, '0')}`, due_date: `${y}-${String(m).padStart(2, '0')}-05`,
        rent_excluding_charges: 700, charges: 50, additional_amount: 0, total_due: 750, paid_amount: 0, balance: 750,
        status: 'unpaid', tenant_name: 'Loc Test',
      });
      reg(svc.entities.RentDue, d.id);
      return d;
    };
    const recordPayment = async (date: string, amount: number, dueId: string, method = 'virement') => {
      const p = await svc.entities.Payment.create({
        owner_id: user.email, is_demo: true, lease_id: lease.id, rent_due_id: dueId, date, amount: R2(amount),
        payer_type: 'tenant', payer_name: 'Loc Test', method, allocations: [{ rent_due_id: dueId, amount: R2(amount) }],
        unallocated: 0,
      });
      reg(svc.entities.Payment, p.id);
      // recalc due
      const all = await svc.entities.Payment.filter({ lease_id: lease.id });
      let paid = 0;
      for (const pp of all) for (const a of pp.allocations || []) if (a.rent_due_id === dueId) paid = R2(paid + Number(a.amount) || 0);
      await svc.entities.RentDue.update(dueId, { paid_amount: paid, balance: R2(750 - paid), status: paid >= 750 ? 'paid' : paid > 0 ? 'partial' : 'unpaid' });
      return p;
    };
    const call = async (due: any) => {
      return await generateQuittanceFor(svc, user, { lease_id: lease.id, year: due.year, month: due.month });
    };
    const deleteQuittance = async (id: string) => { await svc.entities.Quittance.delete(id).catch(() => {}); };

    // --- 1. Paiement total -> full ---
    {
      const d = await makeDue(2026, 7);
      await recordPayment('2026-07-04', 750, d.id);
      const r = await call(d);
      tryAssert('paiement total: ok', () => { if (!r.ok) throw new Error(JSON.stringify(r)); });
      tryAssert('paiement total: kind=full', () => { if (r.quittance.kind !== 'full') throw new Error('kind=' + r.quittance.kind); });
      tryAssert('paiement total: balance=0', () => { if (R2(r.quittance.balance) !== 0) throw new Error('balance=' + r.quittance.balance); });
      tryAssert('paiement total: payment_date réel', () => { if (r.quittance.payment_date !== '2026-07-04') throw new Error('payment_date=' + r.quittance.payment_date); });
      tryAssert('paiement total: paid=750', () => { if (R2(r.quittance.paid_amount) !== 750) throw new Error('paid=' + r.quittance.paid_amount); });
      await deleteQuittance(r.quittance.id);
    }

    // --- 2. Paiement partiel -> partial + solde restant ---
    {
      const d = await makeDue(2026, 6);
      await recordPayment('2026-06-10', 300, d.id);
      const r = await call(d);
      tryAssert('partiel: ok', () => { if (!r.ok) throw new Error(JSON.stringify(r)); });
      tryAssert('partiel: kind=partial', () => { if (r.quittance.kind !== 'partial') throw new Error('kind=' + r.quittance.kind); });
      tryAssert('partiel: paid=300', () => { if (R2(r.quittance.paid_amount) !== 300) throw new Error('paid=' + r.quittance.paid_amount); });
      tryAssert('partiel: balance=450', () => { if (R2(r.quittance.balance) !== 450) throw new Error('balance=' + r.quittance.balance); });
      tryAssert('partiel: mention légale partiel', () => { if (!(r.quittance.legal_note || '').includes('partiel')) throw new Error('legal_note=' + r.quittance.legal_note); });
      await deleteQuittance(r.quittance.id);
    }

    // --- 3. Aucun paiement -> refus ---
    {
      const d = await makeDue(2026, 5);
      const r = await call(d);
      tryAssert('impayé: refusé (ok=false)', () => { if (r.ok) throw new Error('devrait être refusé'); });
      tryAssert('impayé: reason=unpaid', () => {
        const reason = r.reason || r.body?.reason;
        if (reason !== 'unpaid') throw new Error('reason=' + reason);
      });
    }

    // --- 4. Trop-perçu -> full + balance < 0 ---
    {
      const d = await makeDue(2026, 4);
      await recordPayment('2026-04-02', 800, d.id);
      const r = await call(d);
      tryAssert('trop-perçu: ok', () => { if (!r.ok) throw new Error(JSON.stringify(r)); });
      tryAssert('trop-perçu: kind=full', () => { if (r.quittance.kind !== 'full') throw new Error('kind=' + r.quittance.kind); });
      tryAssert('trop-perçu: paid=800', () => { if (R2(r.quittance.paid_amount) !== 800) throw new Error('paid=' + r.quittance.paid_amount); });
      tryAssert('trop-perçu: balance=-50', () => { if (R2(r.quittance.balance) !== -50) throw new Error('balance=' + r.quittance.balance); });
      await deleteQuittance(r.quittance.id);
    }

    // --- 5. Immutabilité : modifier le bail ne change pas la quittance ---
    {
      const d = await makeDue(2026, 3);
      await recordPayment('2026-03-05', 750, d.id);
      const r1 = await call(d);
      const q1 = r1.quittance;
      const oldRentHc = q1.rent_hc;
      // on modifie le bail (loyer doublé)
      await svc.entities.Lease.update(lease.id, { rent_excluding_charges: 1400 });
      // on rappelle generateQuittance : doit renvoyer l'existante (reason=exists), inchangée
      const r2 = await call(d);
      const q2 = r2.quittance;
      tryAssert('immutabilité: reason=exists', () => { if (r2.reason !== 'exists') throw new Error('reason=' + r2.reason); });
      tryAssert('immutabilité: même id', () => { if (q2.id !== q1.id) throw new Error('id différent'); });
      tryAssert('immutabilité: rent_hc inchangé (700, pas 1400)', () => {
        if (Number(q2.rent_hc) !== Number(oldRentHc)) throw new Error('rent_hc=' + q2.rent_hc + ' (attendu ' + oldRentHc + ')');
      });
      tryAssert('immutabilité: total_dû inchangé (750)', () => { if (R2(q2.total_due) !== 750) throw new Error('total_due=' + q2.total_due); });
      await deleteQuittance(q2.id);
    }
  } finally {
    // nettoyage (ordre : quittances déjà supprimées dans les scénarios)
    for (const fn of cleanup.reverse()) { try { await fn(); } catch (_e) {} }
  }

  return Response.json({
    ok: errors.length === 0,
    passed: 5 - errors.length,
    total: 5,
    errors,
  });
}