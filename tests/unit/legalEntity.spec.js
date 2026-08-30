import { describe, it, expect } from 'vitest';
import {
  buildCommitPlan, legalEntityCommitPlan, matchLegalEntity, matchPersonHolder,
  computePercentFromShares, validateCapitalStructure,
} from '@/lib/documentCommit';
import { computePropertyOwnershipBreakdown } from '@/lib/ownership';

// --- Données de test -----------------------------------------------------------
const SCI = { id: 'sci1', name: 'SCI DUPONT IMMOBILIER', type: 'SCI', siren: '123456789', capital: 1000, legal_form: 'SCI' };
const PHYS_A = { id: 'pa', name: 'Michael Dupont', type: 'Personne physique' };
const PHYS_B = { id: 'pb', name: 'Sophie Martin', type: 'Personne physique' };
const PHYS_C = { id: 'pc', name: 'Paul Durand', type: 'Personne physique' };

const build = (extracted_data, context = {}, classification = 'statuts_societe', classConf = 0.9) =>
  buildCommitPlan({
    classification,
    extracted_data,
    confidence_per_field: extracted_data.confidence_per_field || { associates: 0.9, company_name: 0.95, siren: 0.95 },
    classification_confidence: classConf,
    context: { holders: context.holders || [SCI, PHYS_A, PHYS_B], members: context.members || [], ...context },
  });

describe('LegalEntityDocumentProcessor — matching société', () => {
  it('SIREN identique → mise à jour, pas de doublon', () => {
    const plan = build({ company_name: 'SCI DUPONT IMMOBILIER', siren: '123456789', capital: 1000 });
    const h = plan.targets.find((t) => t.entity === 'Holder');
    expect(h).toMatchObject({ entity: 'Holder', action: 'update', id: 'sci1' });
    expect(plan.targets.filter((t) => t.entity === 'Holder' && t.action === 'create').length).toBeLessThanOrEqual(0);
  });

  it('nom proche mais SIREN différent → pas de fusion, création + note', () => {
    const plan = build({ company_name: 'SCI DUPONT IMMOBILIER', siren: '999999999', capital: 5000 });
    const h = plan.targets.find((t) => t.entity === 'Holder');
    expect(h.action).toBe('create');
    expect(plan.risk_notes.some((n) => /SIREN.*inconnu/.test(n))).toBe(true);
  });

  it("nom seul, pas de SIREN → mise à jour probable (review requis)", () => {
    const plan = build({ company_name: 'SCI DUPONT IMMOBILIER' });
    const h = plan.targets.find((t) => t.entity === 'Holder');
    expect(h.action).toBe('update');
    expect(h.needs_review).toBe(true);
  });

  it("homonymie de société (2 société même nom) → création + note d'ambiguïté", () => {
    const SCI2 = { id: 'sci2', name: 'SCI DUPONT IMMOBILIER', type: 'SCI' };
    const plan = build({ company_name: 'SCI DUPONT IMMOBILIER' }, { holders: [SCI, SCI2, PHYS_A] });
    const h = plan.targets.find((t) => t.entity === 'Holder');
    expect(h.action).toBe('create');
    expect(plan.risk_notes.some((n) => /Plusieurs sociétés|homonym/i.test(n))).toBe(true);
  });
});

describe('LegalEntityDocumentProcessor — création SCI/SARL/SAS', () => {
  it('création SCI avec 2 associés (Michael 50 %, Sophie 50 %)', () => {
    const plan = build({
      company_name: 'SCI BONJEAN IMMO', legal_form: 'SCI', capital: 1000, total_shares: 100,
      associates: [
        { name: 'Michael Dupont', share_percent: 50 },
        { name: 'Sophie Martin', share_percent: 50 },
      ],
    }, { holders: [PHYS_A, PHYS_B] });
    const societe = plan.targets.find((t) => t.entity === 'Holder' && t.action === 'create');
    expect(societe.data.type).toBe('SCI');
    const members = plan.targets.filter((t) => t.entity === 'HolderMember');
    expect(members).toHaveLength(2);
    expect(members.every((m) => m.data.share_percent === 50 && m.needs_review)).toBe(true);
    expect(plan.risk_notes.some((n) => /totalisent 100|≠ 100/.test(n))).toBe(false);
  });

  it('création SCI avec 3 associés', () => {
    const plan = build({
      company_name: 'SCI TROIS', legal_form: 'SCI', capital: 3000,
      associates: [
        { name: 'Michael Dupont', share_percent: 40 },
        { name: 'Sophie Martin', share_percent: 30 },
        { name: 'Paul Durand', share_percent: 30 },
      ],
    }, { holders: [PHYS_A, PHYS_B, PHYS_C] });
    expect(plan.targets.filter((t) => t.entity === 'HolderMember')).toHaveLength(3);
    expect(plan.risk_notes.some((n) => /≠ 100/.test(n))).toBe(false);
  });

  it('SARL détectée (legal_form)', () => {
    const plan = build({ company_name: 'DURAND SARL', legal_form: 'SARL', capital: 5000, associates: [{ name: 'Paul Durand', share_percent: 100 }] }, { holders: [PHYS_C] });
    expect(plan.targets.find((t) => t.entity === 'Holder').data.type).toBe('SARL');
  });

  it('SAS détectée (legal_form)', () => {
    const plan = build({ company_name: 'HOLD SAS', legal_form: 'SAS', capital: 10000, associates: [{ name: 'Michael Dupont', share_percent: 100 }] }, { holders: [PHYS_A] });
    expect(plan.targets.find((t) => t.entity === 'Holder').data.type).toBe('SAS');
  });
});

describe('LegalEntityDocumentProcessor — associés', () => {
  it('associé personne morale réutilise le Holder société existant (SIREN)', () => {
    const plan = build({
      company_name: 'HOLD SAS', legal_form: 'SAS', capital: 10000,
      associates: [{ name: 'SCI DUPONT IMMOBILIER', type: 'personne_morale', siren: '123456789', share_percent: 100 }],
    }, { holders: [SCI, PHYS_A] });
    // Pas de création de Holder pour l'associé moral (déjà existant).
    const created = plan.targets.filter((t) => t.entity === 'Holder' && t.action === 'create');
    expect(created.some((t) => /DUPONT/.test(t.data.name))).toBe(false);
    const member = plan.targets.find((t) => t.entity === 'HolderMember');
    expect(member.data.member_holder_id).toBe('sci1');
  });

  it('associé personne physique : réutilise le Holder existant', () => {
    const plan = build({
      company_name: 'SCI X', legal_form: 'SCI', capital: 1000,
      associates: [{ name: 'Michael Dupont', share_percent: 100 }],
    }, { holders: [SCI, PHYS_A] });
    expect(plan.targets.filter((t) => t.entity === 'Holder' && t.action === 'create').some((t) => t.data.name === 'Michael Dupont')).toBe(false);
    const member = plan.targets.find((t) => t.entity === 'HolderMember');
    expect(member.data.member_holder_id).toBe('pa');
  });

  it("personne physique ambiguë (2 homonymes) → note, pas de fusion auto", () => {
    const A2 = { id: 'pa2', name: 'Michael Dupont', type: 'Personne physique' };
    const plan = build({
      company_name: 'SCI Y', legal_form: 'SCI', capital: 1000,
      associates: [{ name: 'Michael Dupont', share_percent: 100 }],
    }, { holders: [SCI, PHYS_A, A2] });
    expect(plan.risk_notes.some((n) => /ambigu/i.test(n))).toBe(true);
    // La relation reste en attente (member_holder_id non résolu), review requis.
    const member = plan.targets.find((t) => t.entity === 'HolderMember');
    expect(member.needs_review).toBe(true);
  });
});

describe('LegalEntityDocumentProcessor — cohérence des pourcentages', () => {
  it('total = 100 % → aucune note d écart', () => {
    const r = validateCapitalStructure([{ share_percent: 50 }, { share_percent: 50 }]);
    expect(r.ok).toBe(true);
    expect(r.note).toBeNull();
  });
  it('total > 100 % → note', () => {
    expect(validateCapitalStructure([{ share_percent: 60 }, { share_percent: 50 }]).note).toMatch(/110/);
  });
  it('total < 100 % → note', () => {
    expect(validateCapitalStructure([{ share_percent: 40 }, { share_percent: 50 }]).note).toMatch(/90/);
  });
  it('parts converties en pourcentage (60/100 → 60 %)', () => {
    expect(computePercentFromShares(60, 100)).toBe(60);
    const r = validateCapitalStructure([{ share_count: 60, total_shares: 100 }, { share_count: 40, total_shares: 100 }]);
    expect(r.total).toBe(100);
    expect(r.ok).toBe(true);
  });
  it("parts incomplètes → pas d'assertion de total", () => {
    expect(computePercentFromShares(60, undefined)).toBeUndefined();
  });
});

describe('LegalEntityDocumentProcessor — changements de détention', () => {
  const EXISTING_MEMBER = { id: 'mem1', parent_holder_id: 'sci1', member_holder_id: 'pb', share_percent: 50, entry_date: '2023-01-01' };

  it('cession de parts : sortie du vendeur (exit_date) + entrée du cessionnaire, historique conservé', () => {
    const plan = build({
      company_name: 'SCI DUPONT IMMOBILIER', siren: '123456789',
      associates: [
        { name: 'Sophie Martin', exit_date: '2026-08-01', share_percent: 50 },
        { name: 'Paul Durand', entry_date: '2026-08-01', share_percent: 50 },
      ],
    }, { holders: [SCI, PHYS_A, PHYS_B, PHYS_C], members: [EXISTING_MEMBER] }, 'cession_parts');
    const exitUpdate = plan.targets.find((t) => t.entity === 'HolderMember' && t.action === 'update');
    expect(exitUpdate).toMatchObject({ id: 'mem1' });
    expect(exitUpdate.data.exit_date).toBe('2026-08-01');
    expect(exitUpdate.data.change_reason).toBe('cession');
    const creates = plan.targets.filter((t) => t.entity === 'HolderMember' && t.action === 'create');
    expect(creates.some((m) => m.data.member_holder_id === 'pc')).toBe(true);
  });

  it('entrée d un nouvel associé (aucune exit_date)', () => {
    const plan = build({
      company_name: 'SCI DUPONT IMMOBILIER', siren: '123456789',
      associates: [
        { name: 'Michael Dupont', share_percent: 50 },
        { name: 'Paul Durand', share_percent: 50, entry_date: '2026-01-01' },
      ],
    }, { holders: [SCI, PHYS_A, PHYS_B, PHYS_C], members: [EXISTING_MEMBER] }, 'pv_assemblee');
    const members = plan.targets.filter((t) => t.entity === 'HolderMember');
    expect(members.some((m) => m.data.member_holder_id === 'pc' && m.data.entry_date === '2026-01-01')).toBe(true);
  });

  it('augmentation de capital → change_reason augmentation_capital', () => {
    const plan = build({
      company_name: 'SCI DUPONT IMMOBILIER', siren: '123456789', capital: 2000, total_shares: 200,
      associates: [{ name: 'Michael Dupont', share_count: 100, share_percent: 50 }, { name: 'Sophie Martin', share_count: 100, share_percent: 50 }],
    }, { holders: [SCI, PHYS_A, PHYS_B] }, 'augmentation_capital');
    const member = plan.targets.find((t) => t.entity === 'HolderMember');
    expect(member.data.change_reason).toBe('augmentation_capital');
    expect(plan.targets.find((t) => t.entity === 'Holder').data.capital).toBe(2000);
  });

  it('statuts mis à jour (statuts_societe) sur société existante → update', () => {
    const plan = build({ company_name: 'SCI DUPONT IMMOBILIER', siren: '123456789', capital: 1500, associates: [{ name: 'Michael Dupont', share_percent: 100 }] }, { holders: [SCI, PHYS_A] }, 'statuts_societe');
    expect(plan.targets.find((t) => t.entity === 'Holder')).toMatchObject({ action: 'update', id: 'sci1' });
  });
});

describe('LegalEntityDocumentProcessor — conflits & robustesse', () => {
  it('conflit de capital entre document et structure existante → note', () => {
    const plan = build({ company_name: 'SCI DUPONT IMMOBILIER', siren: '123456789', capital: 5000, associates: [{ name: 'Michael Dupont', share_percent: 100 }] });
    expect(plan.risk_notes.some((n) => /Conflit sur le capital/.test(n))).toBe(true);
  });

  it('document sans associé ni dénomination → review + note', () => {
    const plan = build({ siren: '123456789' }, { holders: [SCI] });
    expect(plan.needs_review).toBe(true);
    expect(plan.risk_notes.some((n) => /associé détecté/.test(n))).toBe(true);
  });

  it('classification faible → needs_review global', () => {
    const plan = build({ company_name: 'SCI LOW', legal_form: 'SCI', capital: 1000 }, { holders: [] }, 'statuts_societe', 0.5);
    expect(plan.needs_review).toBe(true);
  });

  it("jamais de régime fiscal déduit de la forme juridique", () => {
    const plan = build({ company_name: 'SCI FISC', legal_form: 'SCI', capital: 1000, associates: [{ name: 'Michael Dupont', share_percent: 100 }] }, { holders: [PHYS_A] });
    expect(plan.targets.find((t) => t.entity === 'Holder').data.tax_regime).toBeUndefined();
    expect(plan.risk_notes.some((n) => /Régime fiscal non renseigné/.test(n))).toBe(true);
  });

  it("démembrement détecté → conservé + alerte", () => {
    const plan = build({
      company_name: 'SCI DEM', legal_form: 'SCI', capital: 1000,
      associates: [{ name: 'Michael Dupont', share_percent: 50, demembrement: 'usufruit' }, { name: 'Sophie Martin', share_percent: 50, demembrement: 'nue_propriete' }],
    }, { holders: [PHYS_A, PHYS_B] });
    expect(plan.risk_notes.some((n) => /démembrement/i.test(n))).toBe(true);
    const members = plan.targets.filter((t) => t.entity === 'HolderMember');
    expect(members.find((m) => m.data.demembrement === 'usufruit')).toBeTruthy();
  });

  it('boucle de détention (associé = la société elle-même) → note', () => {
    const plan = build({
      company_name: 'SCI DUPONT IMMOBILIER', siren: '123456789', capital: 1000,
      associates: [{ name: 'SCI DUPONT IMMOBILIER', type: 'personne_morale', siren: '123456789', share_percent: 100 }],
    }, { holders: [SCI, PHYS_A] });
    expect(plan.risk_notes.some((n) => /Boucle de détention/.test(n))).toBe(true);
  });
});

describe('LegalEntityDocumentProcessor — détention indirecte (ownership engine)', () => {
  it('Michael 50 % Holding A, Holding A 80 % SCI B, SCI B 100 % bien → Michael 40 %', () => {
    const HOLD = { id: 'hold1', name: 'HOLD A', type: 'Holding' };
    const SCI_B = { id: 'scib', name: 'SCI B', type: 'SCI' };
    const PROP = { id: 'p1' };
    const members = [
      { id: 'm1', parent_holder_id: 'hold1', member_holder_id: 'pa', share_percent: 50 },
      { id: 'm2', parent_holder_id: 'hold1', member_holder_id: 'pb', share_percent: 50 },
      { id: 'm3', parent_holder_id: 'scib', member_holder_id: 'hold1', share_percent: 80 },
    ];
    const propertyHolders = [{ id: 'ph1', property_id: 'p1', holder_id: 'scib', share_percent: 100 }];
    const res = computePropertyOwnershipBreakdown({ propertyId: 'p1', holders: [PHYS_A, PHYS_B, HOLD, SCI_B], members, propertyHolders });
    const michael = res.rows.find((r) => r.personId === 'pa');
    expect(michael.economic_percent).toBeCloseTo(40, 1);
    const sophie = res.rows.find((r) => r.personId === 'pb');
    expect(sophie.economic_percent).toBeCloseTo(40, 1);
  });
});

describe('LegalEntityDocumentProcessor — rattachement Property→SCI (acte de vente)', () => {
  it("l'acte de vente réutilise la SCI existante pour le PropertyHolder (pas de doublon)", () => {
    const PROP = { id: 'p1', name: 'Immeuble Lyon', address: '12 rue de la Paix', postal_code: '69002', city: 'Lyon' };
    const plan = buildCommitPlan({
      classification: 'acte_vente_notarie',
      extracted_data: {
        address: '12 rue de la Paix, 69002 Lyon',
        purchase_price: 250000,
        buyers: [{ name: 'SCI DUPONT IMMOBILIER', type: 'personne_morale', siren: '123456789', share_percent: 100 }],
      },
      confidence_per_field: { buyers: 0.95, shares: 0.95, purchase_price: 0.9 },
      classification_confidence: 0.95,
      context: { properties: [PROP], lots: [], leases: [], holders: [SCI, PHYS_A] },
    });
    // Pas de création de Holder « SCI DUPONT » : update de l'existant.
    expect(plan.targets.some((t) => t.entity === 'Holder' && t.action === 'create' && /DUPONT/.test(t.data.name || ''))).toBe(false);
    const holderTarget = plan.targets.find((t) => t.entity === 'Holder');
    expect(holderTarget).toMatchObject({ action: 'update', id: 'sci1' });
    const ph = plan.targets.find((t) => t.entity === 'PropertyHolder');
    expect(ph.data.holder_id).toBe('sci1');
  });
});

describe('LegalEntityDocumentProcessor — helpers unitaires', () => {
  it('matchLegalEntity : priorité SIREN', () => {
    expect(matchLegalEntity({ siren: '123456789' }, [SCI])?.holder.id).toBe('sci1');
    expect(matchLegalEntity({ siren: '000000000' }, [SCI])).toBeNull();
    expect(matchLegalEntity({ company_name: 'SCI DUPONT IMMOBILIER' }, [SCI])?.match).toBe('name');
  });
  it('matchPersonHolder : personne morale par SIREN', () => {
    expect(matchPersonHolder({ name: 'SCI DUPONT IMMOBILIER', type: 'personne_morale', siren: '123456789' }, [SCI])?.holder.id).toBe('sci1');
  });
});