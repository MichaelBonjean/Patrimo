import { describe, it, expect } from 'vitest';
import { buildCommitPlan, matchLegalEntity } from '@/lib/documentCommit';

// Données de test — portefeuille existant (société + personnes physiques).
const SCI = { id: 'sci1', name: 'SCI DUPONT IMMOBILIER', type: 'SCI', siren: '123456789', capital: 1000, legal_form: 'SCI' };
const PHYS_A = { id: 'pa', name: 'Michael Dupont', type: 'Personne physique' };
const PHYS_B = { id: 'pb', name: 'Sophie Martin', type: 'Personne physique' };
const PHYS_C = { id: 'pc', name: 'Paul Durand', type: 'Personne physique' };

const build = (extracted_data, context = {}, classification = 'statuts_societe', classConf = 0.9) =>
  buildCommitPlan({
    classification,
    extracted_data,
    confidence_per_field: extracted_data.confidence_per_field || { associates: 0.9, company_name: 0.95, siren: 0.95, capital: 0.9 },
    classification_confidence: classConf,
    context: {
      holders: context.holders || [SCI, PHYS_A, PHYS_B],
      members: context.members || [],
      ...context,
    },
  });

describe('LegalEntityPipeline — extraction statuts', () => {
  it('statuts SANS SIREN : société créée (pas de fusion par le nom) + associé rattaché', () => {
    const plan = build({
      company_name: 'SCI NOUVELLE', legal_form: 'SCI', capital: 5000,
      associates: [{ name: 'Michael Dupont', share_percent: 100 }],
    }, { holders: [PHYS_A] });
    const h = plan.targets.find((t) => t.entity === 'Holder');
    expect(h.action).toBe('create');
    expect(plan.risk_notes.some((n) => /Société non reconnue/.test(n))).toBe(true);
    const member = plan.targets.find((t) => t.entity === 'HolderMember');
    expect(member.data.member_holder_id).toBe('pa');
  });

  it('statuts AVEC nombre de parts (60/100, 40/100) → pourcentages calculés 60 % et 40 %', () => {
    const plan = build({
      company_name: 'SCI PARTS', legal_form: 'SCI', capital: 1000, total_shares: 100,
      associates: [{ name: 'Michael Dupont', share_count: 60 }, { name: 'Sophie Martin', share_count: 40 }],
    }, { holders: [PHYS_A, PHYS_B] });
    const members = plan.targets.filter((t) => t.entity === 'HolderMember');
    expect(members.find((m) => m.data.share_percent === 60 && m.data.member_holder_id === 'pa')).toBeTruthy();
    expect(members.find((m) => m.data.share_percent === 40 && m.data.member_holder_id === 'pb')).toBeTruthy();
    expect(plan.risk_notes.some((n) => /≠ 100/.test(n))).toBe(false);
  });
});

describe('LegalEntityPipeline — Kbis seul', () => {
  it('Kbis : société reconnue (SIREN), AUCUN associé créé, note associé absent', () => {
    const plan = build({
      company_name: 'SCI DUPONT IMMOBILIER', siren: '123456789', legal_form: 'SCI',
      capital: 1000, registration_date: '2024-01-01', rcs_number: 'RCS Paris',
      representative_name: 'Michael Dupont',
    }, { holders: [SCI, PHYS_A] }, 'kbis_societe');
    const h = plan.targets.find((t) => t.entity === 'Holder');
    expect(h).toMatchObject({ action: 'update', id: 'sci1' });
    // Un Kbis ne liste pas les associés → aucun HolderMember.
    expect(plan.targets.filter((t) => t.entity === 'HolderMember')).toHaveLength(0);
    expect(plan.risk_notes.some((n) => /associé détecté/i.test(n))).toBe(true);
  });
});

describe('LegalEntityPipeline — cession de parts (proposition)', () => {
  const EXISTING_MEMBER = { id: 'mem1', parent_holder_id: 'sci1', member_holder_id: 'pb', share_percent: 50, entry_date: '2023-01-01' };

  it('cession (seller/buyer) : sortie du cédant + entrée du cessionnaire, historique conservé', () => {
    const plan = build({
      company_name: 'SCI DUPONT IMMOBILIER', siren: '123456789',
      seller: 'Sophie Martin', buyer: 'Paul Durand',
      shares_transferred: 50, share_percent: 50, effective_date: '2026-08-10',
    }, { holders: [SCI, PHYS_A, PHYS_B, PHYS_C], members: [EXISTING_MEMBER] }, 'cession_parts');

    const exitUpdate = plan.targets.find((t) => t.entity === 'HolderMember' && t.action === 'update');
    expect(exitUpdate).toMatchObject({ id: 'mem1' });
    expect(exitUpdate.data.exit_date).toBe('2026-08-10');
    expect(exitUpdate.data.change_reason).toBe('cession');

    const creates = plan.targets.filter((t) => t.entity === 'HolderMember' && t.action === 'create');
    expect(creates.some((m) => m.data.member_holder_id === 'pc' && m.data.entry_date === '2026-08-10')).toBe(true);
    // Le cédant n'est PAS supprimé : son ancienne relation est conservée (exit_date + raison).
    expect(exitUpdate.reason).toMatch(/historique conservé/i);
  });
});

describe('LegalEntityPipeline — variations de capital & bénéficiaires', () => {
  it('réduction de capital : change_reason reduction_capital + capital = new_capital', () => {
    const plan = build({
      company_name: 'SCI DUPONT IMMOBILIER', siren: '123456789',
      old_capital: 2000, new_capital: 1000, total_shares: 50,
      associates: [{ name: 'Michael Dupont', share_percent: 50 }, { name: 'Sophie Martin', share_percent: 50 }],
    }, { holders: [SCI, PHYS_A, PHYS_B] }, 'reduction_capital');
    const member = plan.targets.find((t) => t.entity === 'HolderMember');
    expect(member.data.change_reason).toBe('reduction_capital');
    expect(plan.targets.find((t) => t.entity === 'Holder').data.capital).toBe(1000);
  });

  it('bénéficiaires effectifs : matérialisés comme associés à valider + note RBE', () => {
    const plan = build({
      company_name: 'SCI DUPONT IMMOBILIER', siren: '123456789',
      beneficial_owners: [{ name: 'Michael Dupont', type: 'individual', share_percent: 100, control_nature: 'détention directe' }],
    }, { holders: [SCI, PHYS_A] }, 'beneficiaires_effectifs');
    expect(plan.risk_notes.some((n) => /bénéficiaires effectifs/i.test(n))).toBe(true);
    const member = plan.targets.find((t) => t.entity === 'HolderMember');
    expect(member).toBeTruthy();
    expect(member.data.member_holder_id).toBe('pa');
  });
});

describe('LegalEntityPipeline — matching société (probabiliste sans fusion)', () => {
  it('dénomination proche (tokens communs ≥ 0,7) → création, pas de fusion auto, note', () => {
    const SIM = { id: 'sim', name: 'SCI DUPONT IMMOBILIER HOLDING', type: 'SCI', siren: '999888777' };
    const plan = build({
      company_name: 'SCI DUPONT IMMOBILIER', legal_form: 'SCI', capital: 1000,
      associates: [{ name: 'Michael Dupont', share_percent: 100 }],
    }, { holders: [SIM, PHYS_A] });
    const h = plan.targets.find((t) => t.entity === 'Holder');
    expect(h.action).toBe('create');
    // Pas de réutilisation de la société au nom proche.
    expect(h.id).toBeUndefined();
    expect(plan.risk_notes.some((n) => /pas de fusion automatique|nom proche/i.test(n))).toBe(true);
  });

  it('matchLegalEntity : correspondance probabiliste retournée sans holder lié', () => {
    const SIM = { id: 'sim', name: 'SCI DUPONT IMMOBILIER HOLDING', type: 'SCI' };
    const r = matchLegalEntity({ company_name: 'SCI DUPONT IMMOBILIER' }, [SIM]);
    expect(r.match).toBe('similar_name');
    expect(r.holder).toBeNull();
    expect(r.candidate.id).toBe('sim');
  });
});

describe('LegalEntityPipeline — robustesse OCR', () => {
  it('OCR à faible confiance (classConf 0,4) → needs_review global', () => {
    const plan = build({
      company_name: 'SCI OCR', legal_form: 'SCI', capital: 1000,
      associates: [{ name: 'Michael Dupont', share_percent: 100 }],
    }, { holders: [PHYS_A] }, 'statuts_societe', 0.4);
    expect(plan.needs_review).toBe(true);
  });
});