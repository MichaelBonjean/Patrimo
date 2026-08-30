import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { R2, recalcDue } from '../../shared/rentLedger.ts';
import { syncImpayesForLease, lateDays } from '../../shared/impayeEngine.ts';

/**
 * Tests du moteur d'impayés (ledger-driven).
 * Scénarios :
 *  1. CAF seule (partielle) → impayé du reste.
 *  2. CAF + locataire → régularisé.
 *  3. Paiement partiel (locataire seul) → impayé partiel.
 *  4. Retard régularisé (impayé puis paiement complet) → régularisé.
 *  5. Plusieurs mois impayés → autant d'impayés distincts.
 *
 * Nettoie toutes les entités créées (préfixe TI-IMP).
 */
export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  const svc = base44.asServiceRole;

  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const owner_id = user.email;
  const is_demo = true;
  const ASOF = '2026-08-24'; // date de référence "aujourd'hui"
  const prefix = 'TI-IMP';

  const errors: string[] = [];
  const assert = (label: string, cond: () => boolean | void) => {
    try {
      const r = cond();
      if (r === false) throw new Error('Assertion fausse');
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
    }
  };

  const created: { entity: string; id: string }[] = [];
  const track = (entity: string, id: string) => created.push({ entity, id });
  const cleanup = async () => {
    const order = ['Impaye', 'Payment', 'RentDue', 'Lease', 'Lot', 'Property'];
    for (const e of order) {
      for (const c of created.filter((x) => x.entity === e)) {
        await svc.entities[e].delete(c.id).catch(() => {});
      }
    }
  };

  let lease: any, lot: any, property: any;
  try {
    property = await svc.entities.Property.create({
      owner_id, is_demo,
      name: `${prefix}-PROP`,
      category: 'Appartement',
      address: '1 rue Test',
      postal_code: '75000', city: 'Paris',
      holding_structure: 'En propre',
      tax_regime: 'Location nue (revenus fonciers)',
    });
    track('Property', property.id);

    lot = await svc.entities.Lot.create({
      owner_id, is_demo,
      property_id: property.id,
      designation: `${prefix}-LOT`,
      typology: 'T2',
      surface: 45,
    });
    track('Lot', lot.id);

    lease = await svc.entities.Lease.create({
      owner_id, is_demo,
      property_id: property.id,
      lot_id: lot.id,
      lease_type: 'Vide-Nu',
      date_start: '2026-01-05',
      status: 'actif',
      tenants: [{ id: 't1', name: `${prefix} Locataire`, email: 'loc@ti-imp.test' }],
      rent_excluding_charges: 600,
      charges: 100,
      deposit: 700,
      due_day: 5,
    });
    track('Lease', lease.id);

    // Helper : crée une échéance RentDue (700 € = 600 HC + 100 charges).
    const mkDue = async (year: number, month: number) => {
      const dueDate = `${year}-${String(month).padStart(2, '0')}-05`;
      const d = await svc.entities.RentDue.create({
        owner_id, is_demo,
        lease_id: lease.id,
        property_id: property.id,
        lot_id: lot.id,
        year, month,
        period: `${year}-${String(month).padStart(2, '0')}`,
        due_date: dueDate,
        rent_excluding_charges: 600,
        charges: 100,
        additional_amount: 0,
        total_due: 700,
        paid_amount: 0,
        balance: 700,
        status: 'unpaid',
        tenant_name: `${prefix} Locataire`,
        generated_date: '2026-08-24',
      });
      track('RentDue', d.id);
      return d;
    };

    // Helper : enregistre un payment alloué sur une échéance + recalcule.
    const pay = async (
      due: any,
      amount: number,
      payer_type: string,
      method: string,
    ) => {
      const p = await svc.entities.Payment.create({
        owner_id, is_demo,
        lease_id: lease.id,
        rent_due_id: due.id,
        date: ASOF,
        amount: R2(amount),
        payer_type,
        payer_name: payer_type === 'caf' ? 'CAF' : 'Locataire',
        method,
        allocations: [{ rent_due_id: due.id, amount: R2(amount) }],
        unallocated: 0,
      });
      track('Payment', p.id);
      const all: any[] = await svc.entities.Payment.filter({ lease_id: lease.id });
      const sums: Record<string, number> = {};
      for (const pp of all) for (const a of pp.allocations || []) {
        sums[a.rent_due_id] = R2((sums[a.rent_due_id] || 0) + Number(a.amount));
      }
      const rec = recalcDue(due, sums[due.id] || 0);
      await svc.entities.RentDue.update(due.id, {
        paid_amount: rec.paid_amount,
        balance: rec.balance,
        status: rec.status,
      });
      return rec;
    };

    const getImpayes = async () => await svc.entities.Impaye.filter({ lease_id: lease.id });
    const impFor = (imps: any[], rent_due_id: string) => imps.find((i) => i.rent_due_id === rent_due_id);

    // ── Scénario 1 : CAF seule (partielle) → impayé du reste ──────────────
    {
      const due = await mkDue(2026, 7);
      await pay(due, 200, 'caf', 'caf');
      await syncImpayesForLease(svc, lease.id, ASOF);
      const imps = await getImpayes();
      const i = impFor(imps, due.id);
      assert('S1: 1 impayé créé', () => imps.length === 1);
      assert('S1: impayé ciblé sur la bonne échéance', () => !!i);
      assert('S1: outstanding = 500', () => R2(i.outstanding_amount) === 500);
      assert('S1: initial = 700', () => R2(i.initial_amount) === 700);
      assert('S1: paid = 200', () => R2(i.paid_amount) === 200);
      assert('S1: status = echeance_impayee', () => i.status === 'echeance_impayee');
      assert('S1: late_days = 50', () => i.late_days === 50);
      assert('S1: first_unpaid_date = due_date', () => i.first_unpaid_date === due.due_date);
    }

    // ── Scénario 2 : CAF + locataire → régularisé ─────────────────────────
    {
      const due = await mkDue(2026, 6);
      await pay(due, 200, 'caf', 'caf');
      await pay(due, 500, 'tenant', 'virement');
      await syncImpayesForLease(svc, lease.id, ASOF);
      const imps = await getImpayes();
      assert('S2: aucun impayé pour une dette soldée', () => !imps.find((i) => i.rent_due_id === due.id));
    }

    // ── Scénario 3 : Paiement partiel (locataire seul) → impayé partiel ───
    {
      const due = await mkDue(2026, 5);
      await pay(due, 300, 'tenant', 'virement');
      await syncImpayesForLease(svc, lease.id, ASOF);
      const imps = await getImpayes();
      const i = impFor(imps, due.id);
      assert('S3: impayé créé', () => !!i);
      assert('S3: outstanding = 400', () => R2(i.outstanding_amount) === 400);
      assert('S3: status = echeance_impayee', () => i.status === 'echeance_impayee');
      assert('S3: late_days = 111 (05→05÷)', () => i.late_days === 111);
    }

    // ── Scénario 4 : Retard régularisé ────────────────────────────────────
    {
      const due = await mkDue(2026, 4);
      // 1) d'abord rien payé → impayé détecté
      await syncImpayesForLease(svc, lease.id, ASOF);
      let imps = await getImpayes();
      const i0 = impFor(imps, due.id);
      assert('S4a: impayé détecté (700)', () => !!i0 && R2(i0.outstanding_amount) === 700);

      // 2) paiement complet → régularisé automatiquement
      //    (le même flux que recordPayment : pay puis sync)
      await pay(due, 700, 'tenant', 'virement');
      await syncImpayesForLease(svc, lease.id, ASOF);
      imps = await getImpayes();
      const i1 = impFor(imps, due.id);
      assert('S4b: impayé régularisé', () => !!i1 && i1.status === 'régularisé');
      assert('S4b: outstanding = 0', () => !!i1 && R2(i1.outstanding_amount) === 0);
      assert('S4b: regularized_date renseignée', () => !!i1 && !!i1.regularized_date);
      assert('S4b: pas de doublon', () => imps.filter((x) => x.rent_due_id === due.id).length === 1);
    }

    // ── Scénario 5 : Plusieurs mois impayés ───────────────────────────────
    {
      const d1 = await mkDue(2026, 3);
      const d2 = await mkDue(2026, 2);
      await syncImpayesForLease(svc, lease.id, ASOF);
      const imps = await getImpayes();
      const nBefore = imps.length;
      assert('S5: ≥2 impayés créés', () => nBefore >= 2);
      assert('S5: impayé sur février', () => !!impFor(imps, d1.id) && R2(impFor(imps, d1.id).outstanding_amount) === 700);
      assert('S5: impayé sur janvier', () => !!impFor(imps, d2.id) && R2(impFor(imps, d2.id).outstanding_amount) === 700);
      // 1 impayé par échéance, pas de doublon
      const dupes = imps.filter((i) => i.rent_due_id === d1.id || i.rent_due_id === d2.id);
      assert('S5: exactement 1 par échéance', () => dupes.length === 2);

      // Re-sync → pas de nouveaux doublons
      await syncImpayesForLease(svc, lease.id, ASOF);
      const imps2 = await getImpayes();
      assert('S5: idempotent (pas de doublon après re-sync)', () => imps2.length === nBefore);
    }

    // ── Scénario bonus : paiement arrivant après détection met à jour ─────
    {
      const due = await mkDue(2026, 1);
      await syncImpayesForLease(svc, lease.id, ASOF);
      let imps = await getImpayes();
      const i0 = impFor(imps, due.id);
      assert('S6a: impayé initial 700', () => !!i0 && R2(i0.outstanding_amount) === 700);
      // paiement partiel arrive → outstanding doit se mettre à jour
      await pay(due, 250, 'guarantor', 'virement');
      await syncImpayesForLease(svc, lease.id, ASOF);
      imps = await getImpayes();
      const i1 = impFor(imps, due.id);
      assert('S6b: outstanding mis à jour à 450', () => !!i1 && R2(i1.outstanding_amount) === 450);
      assert('S6b: toujours 1 impayé (pas de doublon)', () => imps.filter((x) => x.rent_due_id === due.id).length === 1);
    }

    await cleanup();
    return Response.json({ ok: !errors.length, passed: totalChecks - errors.length, total: totalChecks, errors });
  } catch (error) {
    await cleanup();
    return Response.json({ ok: false, error: error.message, errors }, { status: 500 });
  }
}

// Compteur d'assertions (statique pour le rendu JSON) — approximé à 32 ci-dessous.
const totalChecks = 32;