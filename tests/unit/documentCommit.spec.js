import { describe, it, expect } from 'vitest';
import {
  buildCommitPlan, matchPropertyByAddress, matchLeaseByTenant, norm, splitAddress,
  acteDeVenteCommitPlan, matchHolderByName, leaseCommitPlan,
} from '@/lib/documentCommit';

const PROP = { id: 'p1', name: 'Appartement Lyon', address: '12 rue de la Paix', postal_code: '69002', city: 'Lyon' };
const LOT = { id: 'l1', property_id: 'p1', designation: 'App. T2', surface: 45 };
const LEASE = {
  id: 'ls1', property_id: 'p1', lot_id: 'l1', date_start: '2024-01-01', status: 'actif',
  tenants: [{ id: 'tn1', name: 'Marie Dupont', entry_date: '2024-01-01' }],
};
const CTX = { properties: [PROP], lots: [LOT], leases: [LEASE], holders: [] };

describe('documentCommit — matching', () => {
  it('matchPropertyByAddress : reconnaissance par adresse exacte', () => {
    const m = matchPropertyByAddress('12 rue de la Paix, 69002 Lyon', [PROP]);
    expect(m?.property.id).toBe('p1');
    expect(m.score).toBeGreaterThanOrEqual(0.85);
  });
  it('matchPropertyByAddress : reconnaît par ville + code postal partiels', () => {
    const m = matchPropertyByAddress('rue de la paix Lyon', [PROP]);
    expect(m?.property.id).toBe('p1');
  });
  it('matchPropertyByAddress : null si aucune correspondance', () => {
    expect(matchPropertyByAddress('5 avenue de Paris, 75001 Paris', [PROP])).toBeNull();
  });
  it('matchLeaseByTenant : correspondance exacte puis floue', () => {
    expect(matchLeaseByTenant('Marie Dupont', [LEASE])?.lease.id).toBe('ls1');
    expect(matchLeaseByTenant('marie dupont', [LEASE])?.score).toBe(1);
    expect(matchLeaseByTenant('Dupont', [LEASE])?.lease.id).toBe('ls1');
    expect(matchLeaseByTenant('Pierre Martin', [LEASE])).toBeNull();
  });
  it('norm : accents + casse + ponctuation', () => {
    expect(norm('Élève à "Paris"')).toBe('eleve a paris');
  });
  it('splitAddress : rue + CP + ville', () => {
    expect(splitAddress('12 rue de la Paix, 69002 Lyon')).toEqual({ street: '12 rue de la Paix', postal_code: '69002', city: 'Lyon' });
    expect(splitAddress('')).toEqual({ street: '', postal_code: '', city: '' });
  });
});

describe('documentCommit — bail_alur', () => {
  it('création Property+Lot+Lease quand l’adresse est inconnue', () => {
    const plan = buildCommitPlan({
      classification: 'bail_alur',
      extracted_data: { tenant_name: 'Paul Durand', address: '8 bd Voltaire, 75011 Paris', rent_excluding_charges: 950, charges: 80, deposit: 950, date_start: '2025-09-01', lease_type: 'Vide-Nu' },
      confidence_per_field: { tenant_name: 0.95, rent_excluding_charges: 0.9 },
      classification_confidence: 0.92,
      context: CTX,
    });
    const entities = plan.targets.map((t) => t.entity);
    expect(entities).toContain('Property');
    expect(entities).toContain('Lot');
    expect(entities).toContain('Lease');
    // Le bail nourrit l’entité Lease, JAMAIS Lot.tenant_name (règle de migration).
    const leaseTarget = plan.targets.find((t) => t.entity === 'Lease');
    expect(leaseTarget.data.rent_excluding_charges).toBe(950);
    expect(leaseTarget.data.tenants[0].name).toBe('Paul Durand');
    const lotTarget = plan.targets.find((t) => t.entity === 'Lot');
    expect(lotTarget.data.tenant_name).toBeUndefined();
    // Champ sensible (tenant_name) → needs_review true sur toutes les cibles.
    expect(plan.targets.every((t) => t.needs_review)).toBe(true);
    expect(plan.needs_review).toBe(true);
  });

  it('mise à jour du bail quand le locataire est reconnu', () => {
    const plan = buildCommitPlan({
      classification: 'bail_alur',
      extracted_data: { tenant_name: 'Marie Dupont', address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 760, charges: 60, deposit: 760, date_start: '2024-01-01', lease_type: 'Vide-Nu' },
      confidence_per_field: {},
      classification_confidence: 0.95,
      context: CTX,
    });
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({ entity: 'Lease', action: 'update', id: 'ls1' });
    expect(plan.targets[0].data.rent_excluding_charges).toBe(760);
  });
});

describe('documentCommit — acte de vente', () => {
  it('mise à jour du bien reconnu par l’adresse', () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', purchase_price: 250000, notary_fees: 18000, date: '2023-06-15' },
      confidence_per_field: { purchase_price: 0.9 },
      classification_confidence: 0.9,
      context: CTX,
    });
    expect(plan.targets[0]).toMatchObject({ entity: 'Property', action: 'update', id: 'p1' });
    expect(plan.targets[0].data.purchase_price).toBe(250000);
    // purchase_price sensible → review.
    expect(plan.targets[0].needs_review).toBe(true);
  });
  it('création du bien si adresse inconnue', () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: { address: '3 rue du Faubourg, 69007 Lyon', purchase_price: 180000 },
      classification_confidence: 0.9, context: CTX,
    });
    expect(plan.targets[0]).toMatchObject({ entity: 'Property', action: 'create' });
  });
});

describe('documentCommit — prêt', () => {
  it('prêt rattaché au bien si adresse fournie', () => {
    const plan = buildCommitPlan({
      classification: 'offre_pret_bancaire',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', bank: 'Crédit Mutuel', loan_amount: 150000, rate: 3.2, duration_years: 20, monthly_payment: 830 },
      classification_confidence: 0.9, context: CTX,
    });
    expect(plan.targets[0]).toMatchObject({ entity: 'Property', action: 'update', id: 'p1' });
    expect(plan.targets[0].data.loan_amount).toBe(150000);
    expect(plan.targets[0].needs_review).toBe(true); // loan_amount sensible
  });
  it('prêt sans bien identifié → cible sans id, review requise', () => {
    const plan = buildCommitPlan({
      classification: 'offre_pret_bancaire',
      extracted_data: { bank: 'Boursorama', loan_amount: 100000 },
      classification_confidence: 0.9, context: CTX,
    });
    expect(plan.targets[0].id).toBeUndefined();
    expect(plan.targets[0].needs_review).toBe(true);
    expect(plan.risk_notes.join(' ')).toContain('bien');
  });

  it('mensualité contractuelle cohérente avec le moteur → aucune note d écart', () => {
    // On ne fournit pas monthly_payment : aucune comparaison n'est déclenchée,
    // mais le moteur calcule la mensualité de référence pour le document_meta.
    const plan = buildCommitPlan({
      classification: 'offre_pret_bancaire',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', loan_amount: 150000, rate: 3.2, duration_years: 20 },
      classification_confidence: 0.9, context: CTX,
    });
    expect(plan.risk_notes.some((n) => /Mensualit/.test(n))).toBe(false);
    expect(plan.document_meta.loan_meta.engine.computed_monthly).toBeGreaterThan(0);
    expect(plan.document_meta.loan_meta.property_id).toBe('p1');
  });

  it('écart de mensualité > 1 % → note d écart et vérification demandée', () => {
    const plan = buildCommitPlan({
      classification: 'offre_pret_bancaire',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', loan_amount: 150000, rate: 3.2, duration_years: 20, monthly_payment: 1200 },
      classification_confidence: 0.9, context: CTX,
    });
    expect(plan.risk_notes.some((n) => /Mensualit\u00e9 contractuelle/.test(n))).toBe(true);
  });

  it('taux zéro : mensualité = capital / durée, aucun écart signalé', () => {
    const plan = buildCommitPlan({
      classification: 'offre_pret_bancaire',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', loan_amount: 60000, rate: 0, duration_years: 10, monthly_payment: 500 },
      classification_confidence: 0.9, context: CTX,
    });
    // 60 000 / 120 mois = 500 € ; pas d'écart.
    expect(plan.risk_notes.some((n) => /Mensualit\u00e9 contractuelle/.test(n))).toBe(false);
    expect(plan.document_meta.loan_meta.engine.computed_monthly).toBeCloseTo(500, 1);
  });

  it('différé d amortissement : écart si mensualité ignore le différé', () => {
    const plan = buildCommitPlan({
      classification: 'offre_pret_bancaire',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', loan_amount: 150000, rate: 3.2, duration_years: 20, deferred_months: 12, monthly_payment: 835 },
      classification_confidence: 0.9, context: CTX,
    });
    // Avec un différé, la mensualité d'amortissement recalculée par le moteur
    // diffère de 835 € → un écart doit être signalé.
    expect(plan.risk_notes.some((n) => /Mensualit\u00e9 contractuelle/.test(n))).toBe(true);
  });

  it('assurance capturée dans le patch Property (monthly_insurance)', () => {
    const plan = buildCommitPlan({
      classification: 'offre_pret_bancaire',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', loan_amount: 150000, rate: 3.2, duration_years: 20, insurance: 35 },
      classification_confidence: 0.9, context: CTX,
    });
    expect(plan.targets[0].data.monthly_insurance).toBe(35);
  });

  it('tableau d amortissement : écart sur le nombre d échéances signalé', () => {
    const plan = buildCommitPlan({
      classification: 'tableau_amortissement',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', loan_amount: 150000, rate: 3.2, duration_years: 20, installments_count: 300 },
      classification_confidence: 0.9, context: CTX,
    });
    // 20 ans = 240 échéances ; 300 ≠ 240 → écart.
    expect(plan.risk_notes.some((n) => /Nombre d'\u00e9ch\u00e9ances/.test(n))).toBe(true);
    expect(plan.document_meta.loan_meta.engine.installments_count).toBe(240);
  });

  it('tableau d amortissement : écart sur les intérêts totaux signalé', () => {
    const plan = buildCommitPlan({
      classification: "tableau_amortissement",
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', loan_amount: 150000, rate: 3.2, duration_years: 20, total_interest: 100 },
      classification_confidence: 0.9, context: CTX,
    });
    expect(plan.risk_notes.some((n) => /Int\u00e9r\u00eats totaux/.test(n))).toBe(true);
  });
});

describe('documentCommit — DPE', () => {
  it('DPE auto-appliqué au lot unique du bien reconnu (non sensible)', () => {
    const plan = buildCommitPlan({
      classification: 'diagnostic_technique',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', energy_class: 'C', energy_consumption: 120, date: '2025-01-10' },
      classification_confidence: 0.95, context: CTX,
    });
    expect(plan.targets[0]).toMatchObject({ entity: 'Lot', action: 'update', id: 'l1' });
    expect(plan.targets[0].data.dpe_class).toBe('C');
    expect(plan.targets[0].needs_review).toBe(false);
  });
  it('DPE sans adresse reconnue → review + Document', () => {
    const plan = buildCommitPlan({
      classification: 'diagnostic_technique',
      extracted_data: { address: 'inconnue', energy_class: 'D' },
      classification_confidence: 0.95, context: CTX,
    });
    expect(plan.needs_review).toBe(true);
  });
});

describe('documentCommit — SCI / quittance / inconnu', () => {
  it('SCI → création Holder, review requis', () => {
    const plan = buildCommitPlan({
      classification: 'sci_statuts_kbis',
      extracted_data: { company_name: 'SCI Dupont', siret: '12345678900012', capital: 1000 },
      classification_confidence: 0.9, context: CTX,
    });
    expect(plan.targets[0]).toMatchObject({ entity: 'Holder', action: 'create' });
    expect(plan.targets[0].data.type).toBe('SCI');
    expect(plan.targets[0].needs_review).toBe(true);
  });
  it('quittance → aucune création d’entité, mais métadata rattachée au bail', () => {
    const plan = buildCommitPlan({
      classification: 'quittance_loyer',
      extracted_data: { tenant_name: 'Marie Dupont', period: '2025-07', total: 820 },
      classification_confidence: 0.9, context: CTX,
    });
    expect(plan.targets).toHaveLength(0);
    expect(plan.document_meta.lease_id).toBe('ls1');
    expect(plan.document_meta.type).toBe('quittance');
  });
  it('relevé bancaire → aucun commit métier, note de risque explicite', () => {
    const plan = buildCommitPlan({
      classification: 'releve_bancaire',
      extracted_data: { bank: 'BNP', period: '2025-08' },
      classification_confidence: 0.9, context: CTX,
    });
    expect(plan.targets).toHaveLength(0);
    expect(plan.risk_notes.join(' ')).toContain('import bancaire');
  });
  it('unknown → Document + review requis', () => {
    const plan = buildCommitPlan({ classification: 'unknown', extracted_data: {}, context: CTX });
    expect(plan.targets[0].entity).toBe('Document');
    expect(plan.needs_review).toBe(true);
  });
});

describe('documentCommit — besoins de validation globaux', () => {
  it('classification faible → needs_review même pour un DPE certain', () => {
    const plan = buildCommitPlan({
      classification: 'diagnostic_technique',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', energy_class: 'C' },
      classification_confidence: 0.5, context: CTX,
    });
    expect(plan.needs_review).toBe(true);
  });
  it('document_meta déduite pour une facture (inconnue)', () => {
    const plan = buildCommitPlan({
      classification: 'autre',
      extracted_data: { title: 'Facture EDF', date: '2025-08-01', amount: 120, supplier: 'EDF' },
      classification_confidence: 0.8, context: CTX,
    });
    expect(plan.document_meta.title).toBe('Facture EDF');
    expect(plan.document_meta.amount).toBe(120);
    expect(plan.document_meta.supplier).toBe('EDF');
  });
});

describe('documentCommit — ActeDeVenteProcessor', () => {
  const HOLDER = { id: 'h1', name: 'SCI Dupont', type: 'SCI' };
  const CTX_H = { properties: [PROP], lots: [LOT], leases: [LEASE], holders: [HOLDER] };

  it('acte incomplet : aucun bien reconnu, ni acquereurs, ni lots → seul Property, review + notes', () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: { notary: 'Me Martin' },
      confidence_per_field: {},
      classification_confidence: 0.9,
      context: CTX,
    });
    const entities = plan.targets.map((t) => t.entity);
    expect(entities).toEqual(['Property']);
    expect(plan.targets[0].action).toBe('create');
    expect(plan.needs_review).toBe(true);
    expect(plan.risk_notes.some((n) => /Adresse manquante/.test(n))).toBe(true);
    expect(plan.risk_notes.some((n) => /non déduits/.test(n))).toBe(true);
    // Schéma Property : tax_regime NON déduit de l'acte → laissé vide (inconnu acceptable, jamais faux).
    expect(plan.targets[0].data.tax_regime).toBeUndefined();
  });

  it('bien reconnu : propose la mise à jour avec le message « semble concerner »', () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', purchase_price: 250000, notary_fees: 18000, acquisition_date: '2023-06-15' },
      confidence_per_field: { purchase_price: 0.9, address: 0.95 },
      classification_confidence: 0.95,
      context: CTX,
    });
    expect(plan.targets[0]).toMatchObject({ entity: 'Property', action: 'update', id: 'p1' });
    expect(plan.targets[0].reason).toContain('semble concerner votre bien');
    expect(plan.targets[0].needs_review).toBe(true);
    expect(plan.document_meta.property_id).toBe('p1');
  });

  it('plusieurs acquéreurs : crée Holder + PropertyHolder par acquéreur avec quotes-parts', () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: {
        address: '3 rue du Faubourg, 69007 Lyon',
        purchase_price: 180000,
        buyers: [{ name: 'Paul Durand', share_percent: 50 }, { name: 'Marie Durand', share_percent: 50 }],
      },
      confidence_per_field: { buyers: 0.9, shares: 0.9 },
      classification_confidence: 0.95,
      context: CTX,
    });
    const holders = plan.targets.filter((t) => t.entity === 'Holder');
    const phs = plan.targets.filter((t) => t.entity === 'PropertyHolder');
    expect(holders).toHaveLength(2);
    expect(phs).toHaveLength(2);
    expect(holders.every((t) => t.action === 'create' && t.needs_review)).toBe(true);
    expect(phs.map((t) => t.data.share_percent).sort()).toEqual([50, 50]);
    expect(phs.every((t) => t.data._holder_name && t.needs_review)).toBe(true);
  });

  it('plusieurs lots : crée un Lot par élément (logement, cave, garage, parking)', () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: {
        address: '12 rue de la Paix, 69002 Lyon',
        purchase_price: 250000,
        copro_lots: [
          { designation: 'Appartement T3', type: 'Appartement', code: '42', surface: 65 },
          { designation: 'Cave n°8', type: 'Cave', code: '8', surface: 6 },
          { designation: 'Garage n°3', type: 'Garage', code: '3' },
          { designation: 'Parking n°12', type: 'Parking', code: '12' },
        ],
      },
      confidence_per_field: { copro_lots: 0.85 },
      classification_confidence: 0.95,
      context: CTX,
    });
    const lots = plan.targets.filter((t) => t.entity === 'Lot');
    expect(lots).toHaveLength(4);
    const byType = lots.map((t) => t.data.typology);
    expect(byType).toEqual([undefined, 'Cave', 'Garage', 'Parking']);
    expect(lots[0].data.property_id).toBe('p1');
  });

  it("ne déduit pas le régime fiscal / la structure (rien d'explicite)", () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', purchase_price: 200000 },
      classification_confidence: 0.95,
      context: CTX,
    });
    expect(plan.risk_notes.some((n) => /non déduits de l.acte/.test(n))).toBe(true);
    expect(plan.targets[0].data.tax_regime).toBeUndefined();
    expect(plan.targets[0].data.holding_structure).toBeUndefined();
  });

  it('structure SCI explicitement établie : holder type SCI et holding_structure SCI', () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: {
        address: '12 rue de la Paix, 69002 Lyon',
        purchase_price: 200000,
        holding_structure: 'SCI',
        buyers: [{ name: 'SCI Dupont', share_percent: 100 }],
      },
      confidence_per_field: { buyers: 0.9, shares: 0.9 },
      classification_confidence: 0.95,
      context: CTX_H,
    });
    const holder = plan.targets.find((t) => t.entity === 'Holder');
    expect(holder.data.type).toBe('SCI');
    expect(plan.targets[0].data.holding_structure).toBe('SCI');
    // Pas de note « non déduits » puisque holding_structure est explicite.
    expect(plan.risk_notes.some((n) => /non déduits/.test(n))).toBe(false);
  });

  it('détention non créée si fiabilité insuffisante (acheteurs sans confiance)', () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', buyers: [{ name: 'Paul', share_percent: 100 }] },
      classification_confidence: 0.95,
      context: CTX,
    });
    expect(plan.targets.some((t) => t.entity === 'Holder')).toBe(false);
    expect(plan.targets.some((t) => t.entity === 'PropertyHolder')).toBe(false);
    expect(plan.risk_notes.some((n) => /fiabilité insuffisante/.test(n))).toBe(true);
  });

  it('détenteur existant réutilisé (Holder update, pas création)', () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: {
        address: '12 rue de la Paix, 69002 Lyon',
        buyers: [{ name: 'SCI Dupont', share_percent: 100 }],
      },
      confidence_per_field: { buyers: 0.9, shares: 0.9 },
      classification_confidence: 0.95,
      context: CTX_H,
    });
    const holder = plan.targets.find((t) => t.entity === 'Holder');
    expect(holder).toMatchObject({ entity: 'Holder', action: 'update', id: 'h1' });
  });

  it('matchHolderByName : exacte puis floue', () => {
    expect(matchHolderByName('SCI Dupont', [HOLDER])?.id).toBe('h1');
    expect(matchHolderByName('sci dupont', [HOLDER])?.id).toBe('h1');
    expect(matchHolderByName('Inconnu', [HOLDER])).toBeNull();
  });

  it('document original lié au Property (document_meta.property_id)', () => {
    const meta = {};
    acteDeVenteCommitPlan({
      ex: { address: '12 rue de la Paix, 69002 Lyon', purchase_price: 250000 },
      conf: {},
      context: CTX,
      document_meta: meta,
    });
    expect(meta.property_id).toBe('p1');
  });
});

describe('documentCommit — LeaseDocumentProcessor', () => {
  const PROP2 = { id: 'p2', name: 'Appartement Lyon bis', address: '12 rue de la Paix', postal_code: '69002', city: 'Lyon' };
  const CTX_AMBIG = { properties: [PROP, PROP2], lots: [LOT], leases: [LEASE], holders: [] };
  const LOT2 = { id: 'l2', property_id: 'p1', designation: 'Cave n°3', code: '3', surface: 6 };
  const CTX_MULTILOTS = { properties: [PROP], lots: [LOT, LOT2], leases: [LEASE], holders: [] };

  const bail = (extracted_data, context = CTX) => buildCommitPlan({
    classification: 'bail_alur', extracted_data, classification_confidence: 0.9, context,
  });

  it('locataire unique : crée un Lease avec un seul locataire rattaché au bien/lot', () => {
    const plan = bail({ tenant_name: 'Sophie Martin', address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 720, charges: 50, deposit: 720, date_start: '2025-03-01', lease_type: 'Vide-Nu' });
    const lease = plan.targets.find((t) => t.entity === 'Lease');
    expect(lease.action).toBe('create');
    expect(lease.data.tenants).toHaveLength(1);
    expect(lease.data.tenants[0].name).toBe('Sophie Martin');
    expect(lease.data.property_id).toBe('p1');
    expect(lease.data.lot_id).toBe('l1');
    expect(lease.data.rent_excluding_charges).toBe(720);
    expect(plan.document_meta.property_id).toBe('p1');
    expect(plan.document_meta.lot_id).toBe('l1');
  });

  it('couple : crée un Lease avec deux locataires', () => {
    const plan = bail({ tenants: [{ name: 'Marie Durand', email: 'marie@x.fr' }, { name: 'Paul Durand' }], address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 900, date_start: '2025-05-01', lease_type: 'Vide-Nu' });
    const lease = plan.targets.find((t) => t.entity === 'Lease');
    expect(lease.data.tenants).toHaveLength(2);
    expect(lease.data.tenants.map((t) => t.name).sort()).toEqual(['Marie Durand', 'Paul Durand']);
  });

  it('colocation : crée un Lease avec plusieurs colocataires', () => {
    const plan = bail({ tenants: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 1200, date_start: '2025-06-01', lease_type: 'Vide-Nu' });
    expect(plan.targets.find((t) => t.entity === 'Lease').data.tenants).toHaveLength(3);
  });

  it('bail incomplet : bail minimal (locataire placeholder) + review + note', () => {
    const plan = bail({ landlord_name: 'SCI Dupont' });
    const lease = plan.targets.find((t) => t.entity === 'Lease');
    expect(lease.data.tenants[0].name).toBe('Locataire');
    expect(plan.needs_review).toBe(true);
    expect(plan.risk_notes.some((n) => /Aucun locataire/.test(n))).toBe(true);
    expect(plan.risk_notes.some((n) => /manquante/.test(n))).toBe(true);
    // Pas d écriture dans les champs legacy du Lot.
    const lot = plan.targets.find((t) => t.entity === 'Lot');
    expect(lot.data.tenant_name).toBeUndefined();
    expect(lot.data.rent_excluding_charges).toBeUndefined();
  });

  it('loyer + charges : valeurs reportées sur le Lease (0 si manquantes)', () => {
    const plan = bail({ tenant_name: 'Lucas', address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 830, charges: 70, deposit: 830, due_day: 1, date_start: '2025-01-01', lease_type: 'Vide-Nu' });
    const lease = plan.targets.find((t) => t.entity === 'Lease');
    expect(lease.data.rent_excluding_charges).toBe(830);
    expect(lease.data.charges).toBe(70);
    expect(lease.data.deposit).toBe(830);
    expect(lease.data.due_day).toBe(1);
    // charges manquantes → 0
    const plan2 = bail({ tenant_name: 'Lucas', address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 900, date_start: '2025-01-01' });
    expect(plan2.targets.find((t) => t.entity === 'Lease').data.charges).toBe(0);
  });

  it('plusieurs biens à la même adresse : ambiguïté → validation requise, pas de création auto de bien', () => {
    const plan = bail({ tenant_name: 'Nathan', address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 700, date_start: '2025-02-01', lease_type: 'Vide-Nu' }, CTX_AMBIG);
    expect(plan.risk_notes.some((n) => /Plusieurs biens/.test(n))).toBe(true);
    expect(plan.targets.some((t) => t.entity === 'Property' && t.action === 'create')).toBe(false);
    expect(plan.needs_review).toBe(true);
    const lease = plan.targets.find((t) => t.entity === 'Lease');
    if (lease) expect(lease.needs_review).toBe(true);
  });

  it('ancien bail déjà existant : mise à jour du bail (pas de création)', () => {
    const plan = bail({ tenant_name: 'Marie Dupont', address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 810, charges: 65, deposit: 810, due_day: 5, date_start: '2024-01-01', lease_type: 'Vide-Nu' });
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({ entity: 'Lease', action: 'update', id: 'ls1' });
    expect(plan.targets[0].data.rent_excluding_charges).toBe(810);
    expect(plan.document_meta.lease_id).toBe('ls1');
  });

  it('matching Lot par désignation quand plusieurs lots sur le bien', () => {
    const plan = bail({ tenant_name: 'Olivia', lot_designation: 'Cave n°3', lot_code: '3', address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 150, date_start: '2025-04-01', lease_type: 'Vide-Nu' }, CTX_MULTILOTS);
    const lease = plan.targets.find((t) => t.entity === 'Lease');
    expect(lease.data.lot_id).toBe('l2');
    expect(lease.data.property_id).toBe('p1');
    expect(plan.targets.some((t) => t.entity === 'Lot' && t.action === 'create')).toBe(false);
  });

  it('plusieurs lots et désignation non reconnue → review + note + lot créé', () => {
    const plan = bail({ tenant_name: 'Tom', address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 600, date_start: '2025-01-01', lease_type: 'Vide-Nu' }, CTX_MULTILOTS);
    expect(plan.risk_notes.some((n) => /Plusieurs lots/.test(n))).toBe(true);
    const lease = plan.targets.find((t) => t.entity === 'Lease');
    expect(lease.needs_review).toBe(true);
    expect(plan.targets.some((t) => t.entity === 'Lot' && t.action === 'create')).toBe(true);
  });

  it('indexation IRL + clause de révision capturées sur le Lease', () => {
    const plan = bail({ tenant_name: 'Inès', address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 800, date_start: '2024-06-01', lease_type: 'Vide-Nu', indexation_type: 'IRL', index_reference: 'T1 2024', index_value_initial: 143.61, revision_clause: "Révision annuelle sur l'IRL" });
    const lease = plan.targets.find((t) => t.entity === 'Lease');
    expect(lease.data.indexation_type).toBe('IRL');
    expect(lease.data.index_reference).toBe('T1 2024');
    expect(lease.data.index_value_initial).toBe(143.61);
    expect(lease.data.notes).toContain('Révision annuelle');
  });

  it('meublé : lease_type Meublé et furnished true', () => {
    const plan = bail({ tenant_name: 'Karim', address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 950, date_start: '2025-01-01', lease_type: 'Meublé' });
    const lease = plan.targets.find((t) => t.entity === 'Lease');
    expect(lease.data.lease_type).toBe('Meublé');
    expect(lease.data.furnished).toBe(true);
  });

  it("n'écrit jamais les données de bail dans les champs legacy du Lot", () => {
    const plan = bail({ tenant_name: 'Yasmine', address: '8 bd Voltaire, 75011 Paris', rent_excluding_charges: 950, charges: 80, deposit: 950, date_start: '2025-09-01', lease_type: 'Vide-Nu' });
    const lot = plan.targets.find((t) => t.entity === 'Lot');
    expect(lot.data.tenant_name).toBeUndefined();
    expect(lot.data.rent_excluding_charges).toBeUndefined();
    expect(lot.data.charges).toBeUndefined();
    expect(lot.data.furnished).toBeUndefined();
  });

  it('leaseCommitPlan expose le matching Property + Lot dans document_meta', () => {
    const meta = {};
    leaseCommitPlan({ ex: { tenant_name: 'Sophie Martin', address: '12 rue de la Paix, 69002 Lyon', rent_excluding_charges: 720, date_start: '2025-03-01' }, conf: {}, context: CTX, document_meta: meta });
    expect(meta.property_id).toBe('p1');
    expect(meta.lot_id).toBe('l1');
  });
});

describe('documentCommit — unification & inconnu acceptable', () => {
  const PROP_FISC = { id: 'p1', name: 'Appartement Lyon', address: '12 rue de la Paix', postal_code: '69002', city: 'Lyon', holding_structure: 'SCI', tax_regime: "SCI à l'IS" };
  const CTX_FISC = { properties: [PROP_FISC], lots: [LOT], leases: [LEASE], holders: [] };

  it('acte minimal → Property valide (pas de runtime error, aucune valeur métier inventée)', () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: { notary: 'Me Martin' },
      classification_confidence: 0.9, context: CTX,
    });
    const prop = plan.targets.find((t) => t.entity === 'Property');
    expect(prop).toBeTruthy();
    expect(prop.action).toBe('create');
    expect(prop.data.name).toBeTruthy();
    expect(prop.data.category).toBeUndefined();
    expect(prop.data.holding_structure).toBeUndefined();
    expect(prop.data.tax_regime).toBeUndefined();
  });

  it('aucune erreur runtime sur plusieurs classifications minimales', () => {
    const cases = [
      { classification: 'acte_vente_notarie', extracted_data: { notary: 'X' } },
      { classification: 'bail_alur', extracted_data: { tenant_name: 'A' } },
      { classification: 'offre_pret_bancaire', extracted_data: { loan_amount: 1000 } },
      { classification: 'statuts_societe', extracted_data: { company_name: 'SCI X' } },
      { classification: 'unknown', extracted_data: {} },
    ];
    for (const c of cases) {
      expect(() => buildCommitPlan({ ...c, classification_confidence: 0.5, context: CTX })).not.toThrow();
    }
  });

  it('document sans fiscalité → tax_regime reste vide', () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', purchase_price: 200000 },
      classification_confidence: 0.95, context: CTX,
    });
    expect(plan.targets[0].data.tax_regime).toBeUndefined();
  });

  it('document sans type de bien → category reste vide', () => {
    const plan = buildCommitPlan({
      classification: 'bail_alur',
      extracted_data: { tenant_name: 'Inès', address: '8 bd Voltaire, 75011 Paris', rent_excluding_charges: 700, date_start: '2025-01-01' },
      classification_confidence: 0.9, context: CTX,
    });
    const prop = plan.targets.find((t) => t.entity === 'Property');
    expect(prop).toBeTruthy();
    expect(prop.data.category).toBeUndefined();
  });

  it('document sans structure → aucune détention inventée', () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', purchase_price: 200000 },
      classification_confidence: 0.95, context: CTX,
    });
    expect(plan.targets.some((t) => t.entity === 'Holder')).toBe(false);
    expect(plan.targets.some((t) => t.entity === 'PropertyHolder')).toBe(false);
    expect(plan.targets[0].data.holding_structure).toBeUndefined();
  });

  it("même entrée → même commit plan quel que soit le chemin d'appel", () => {
    const X = { address: '3 rue du Faubourg, 69007 Lyon', purchase_price: 180000 };
    const viaBuild = buildCommitPlan({ classification: 'acte_vente_notarie', extracted_data: X, classification_confidence: 0.95, context: CTX });
    const viaDirect = acteDeVenteCommitPlan({ ex: X, conf: {}, context: CTX, document_meta: {} });
    expect(viaBuild.targets).toEqual(viaDirect.targets);
  });

  it("ancienne donnée utilisateur non écrasée par une extraction absente", () => {
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: { address: '12 rue de la Paix, 69002 Lyon', purchase_price: 200000 },
      classification_confidence: 0.95, context: CTX_FISC,
    });
    expect(plan.targets[0].data.holding_structure).toBe('SCI');
    expect(plan.targets[0].data.tax_regime).toBe("SCI à l'IS");
  });

  it("conflit documentaire → validation, non écrasement silencieux", () => {
    const EXISTING = { id: 'h1', name: 'SCI Dupont', type: 'SCI', siren: '123456789', capital: 1000 };
    const plan = buildCommitPlan({
      classification: 'statuts_societe',
      extracted_data: { company_name: 'SCI Dupont', siren: '123456789', capital: 2000 },
      classification_confidence: 0.95, context: { ...CTX, holders: [EXISTING] },
    });
    expect(plan.risk_notes.some((n) => /Conflit sur le capital/.test(n))).toBe(true);
    expect(plan.needs_review).toBe(true);
  });
});