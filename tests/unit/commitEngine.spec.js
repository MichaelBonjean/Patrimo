import { describe, it, expect } from 'vitest';
import { resolveAndValidatePlan, applyResolvedRefs } from '../../base44/shared/commitEngine';
import { computeEconomicShare, computePropertyShare } from '../../base44/shared/ownership';
import { legalEntityCommitPlan } from '../../base44/shared/documentCommit';

// Helpers de fabrication de plans synthétiques (temp_ids / refs) + contextes.
const holder = (id, name, type = 'Personne physique') => ({ id, name, type, owner_id: 'u@u' });

const planSocieteEtAssocies = (tempSociete, associes) => {
  // associes: [{ temp, name, share }]
  const targets = [{ entity: 'Holder', action: 'create', temp_id: tempSociete, data: { name: 'SCI A', type: 'SCI', owner_id: 'u@u' } }];
  for (const a of associes) {
    targets.push({ entity: 'Holder', action: 'create', temp_id: a.temp, data: { name: a.name, type: 'Personne physique', owner_id: 'u@u' } });
  }
  for (const a of associes) {
    targets.push({
      entity: 'HolderMember', action: 'create',
      parent_ref: tempSociete, member_ref: a.temp,
      data: { share_percent: a.share, owner_id: 'u@u' },
    });
  }
  return targets;
};

const CTX = (holders = [], members = []) => ({ owner_id: 'u@u', patrimony_id: 'pat1', holders, members });

describe('commitEngine — références temporelles & atomicité', () => {
  it('1. création simultanée société + associés : toutes les cibles ordonnées, aucune erreur', () => {
    const targets = planSocieteEtAssocies('company_1', [
      { temp: 'person_1', name: 'Alice', share: 50 },
      { temp: 'person_2', name: 'Bob', share: 50 },
    ]);
    const { orderedTargets, errors, warnings } = resolveAndValidatePlan(targets, CTX());
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    const ents = orderedTargets.map((t) => t.entity);
    expect(ents.filter((e) => e === 'Holder').length).toBe(3);
    expect(ents.filter((e) => e === 'HolderMember').length).toBe(2);
    // Holders créés avant les HolderMember.
    const firstMemberIdx = ents.indexOf('HolderMember');
    const lastHolderIdx = ents.lastIndexOf('Holder');
    expect(lastHolderIdx).toBeLessThan(firstMemberIdx);
  });

  it('2. répartition 50/50 : total 100 %, aucune erreur ni warning', () => {
    const targets = planSocieteEtAssocies('c1', [
      { temp: 'p1', name: 'A', share: 50 },
      { temp: 'p2', name: 'B', share: 50 },
    ]);
    const { errors, warnings } = resolveAndValidatePlan(targets, CTX());
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('3. répartition 60/40 : total 100 %, ok', () => {
    const targets = planSocieteEtAssocies('c1', [
      { temp: 'p1', name: 'A', share: 60 },
      { temp: 'p2', name: 'B', share: 40 },
    ]);
    const { errors } = resolveAndValidatePlan(targets, CTX());
    expect(errors).toEqual([]);
  });

  it('4. total > 100 % : blocage des membres de la société', () => {
    const targets = planSocieteEtAssocies('c1', [
      { temp: 'p1', name: 'A', share: 60 },
      { temp: 'p2', name: 'B', share: 50 },
    ]);
    const { orderedTargets, errors } = resolveAndValidatePlan(targets, CTX());
    expect(errors.some((e) => /> 100%/.test(e.error))).toBe(true);
    // Les HolderMember bloqués → retirés du lot exécutable.
    expect(orderedTargets.some((t) => t.entity === 'HolderMember')).toBe(false);
  });

  it('5. total < 100 % : autorisé avec warning (document incomplet)', () => {
    const targets = planSocieteEtAssocies('c1', [
      { temp: 'p1', name: 'A', share: 40 },
      { temp: 'p2', name: 'B', share: 40 },
    ]);
    const { orderedTargets, errors, warnings } = resolveAndValidatePlan(targets, CTX());
    expect(errors).toEqual([]);
    expect(orderedTargets.some((t) => t.entity === 'HolderMember')).toBe(true);
    expect(warnings.some((w) => /< 100%/.test(w.warning))).toBe(true);
  });

  it('6. société dans une société : pas derreur', () => {
    const targets = [
      { entity: 'Holder', action: 'create', temp_id: 'sci', data: { name: 'SCI', type: 'SCI' } },
      { entity: 'Holder', action: 'create', temp_id: 'hold', data: { name: 'Holding', type: 'Holding' } },
      { entity: 'HolderMember', action: 'create', parent_ref: 'sci', member_ref: 'hold', data: { share_percent: 100 } },
    ];
    const { errors } = resolveAndValidatePlan(targets, CTX());
    expect(errors).toEqual([]);
  });

  it('7. détention 3 niveaux : Michael 50% Holding × 80% SCI × 100% Property = 40%', () => {
    const michael = holder('h_michael', 'Michael');
    const holding = holder('h_holding', 'Holding', 'Holding');
    const sci = holder('h_sci', 'SCI', 'SCI');
    const members = [
      { id: 'm1', parent_holder_id: 'h_holding', member_holder_id: 'h_michael', share_percent: 50 },
      { id: 'm2', parent_holder_id: 'h_sci', member_holder_id: 'h_holding', share_percent: 80 },
    ];
    const propertyHolders = [
      { id: 'ph1', property_id: 'prop', holder_id: 'h_sci', share_percent: 100 },
    ];
    const eco = computePropertyShare({
      personId: 'h_michael', propertyId: 'prop', members, propertyHolders: propertyHolders,
    });
    expect(Math.round(eco * 1000) / 10).toBe(40); // 0.5 * 0.8 * 1.0
  });

  it('8. boucle A→B→A : détectée et bloquée', () => {
    const targets = [
      { entity: 'Holder', action: 'create', temp_id: 'a', data: { name: 'A', type: 'SCI' } },
      { entity: 'Holder', action: 'create', temp_id: 'b', data: { name: 'B', type: 'SCI' } },
      { entity: 'HolderMember', action: 'create', parent_ref: 'a', member_ref: 'b', data: { share_percent: 50 } },
      { entity: 'HolderMember', action: 'create', parent_ref: 'b', member_ref: 'a', data: { share_percent: 50 } },
    ];
    const { orderedTargets, errors } = resolveAndValidatePlan(targets, CTX());
    expect(errors.some((e) => /boucle indirecte/.test(e.error))).toBe(true);
    expect(orderedTargets.some((t) => t.entity === 'HolderMember')).toBe(false);
  });

  it('boucle directe (parent = member) : bloquée', () => {
    const targets = [
      { entity: 'Holder', action: 'create', temp_id: 'a', data: { name: 'A', type: 'SCI' } },
      { entity: 'HolderMember', action: 'create', parent_ref: 'a', member_ref: 'a', data: { share_percent: 100 } },
    ];
    const { errors } = resolveAndValidatePlan(targets, CTX());
    expect(errors.some((e) => /boucle directe/.test(e.error))).toBe(true);
  });

  it('11/12. cross-patrimony & doublon : orphelin + relation dupliquée bloqués', () => {
    // member_ref pointe vers un holder d'un autre patrimoine (non présent dans le ctx).
    const targets = [
      { entity: 'Holder', action: 'create', temp_id: 'a', data: { name: 'A', type: 'SCI' } },
      { entity: 'HolderMember', action: 'create', parent_ref: 'a', member_ref: 'holder_autre_patrimoine', data: { share_percent: 50 } },
    ];
    const { errors } = resolveAndValidatePlan(targets, CTX());
    expect(errors.some((e) => /member non résolu/.test(e.error))).toBe(true);

    // Doublon : même (parent, member) deux fois.
    const dup = [
      { entity: 'Holder', action: 'create', temp_id: 'a', data: { name: 'A', type: 'SCI' } },
      { entity: 'Holder', action: 'create', temp_id: 'b', data: { name: 'B', type: 'Personne physique' } },
      { entity: 'HolderMember', action: 'create', parent_ref: 'a', member_ref: 'b', data: { share_percent: 50 } },
      { entity: 'HolderMember', action: 'create', parent_ref: 'a', member_ref: 'b', data: { share_percent: 50 } },
    ];
    const r2 = resolveAndValidatePlan(dup, CTX());
    expect(r2.errors.some((e) => /doublon/.test(e.error))).toBe(true);
  });

  it('rollback partiel / cascade : un Holder bloqué entraîne ses dépendants', () => {
    // Le society holder est invalide (share_percent nul sur son membre ET bodu).
    // On provoque un blocage via total > 100% sur la société, puis on vérifie
    // quun PropertyHolder référençant la société bloquée est aussi retiré.
    const targets = [
      { entity: 'Holder', action: 'create', temp_id: 'c1', data: { name: 'SCI', type: 'SCI' } },
      { entity: 'Holder', action: 'create', temp_id: 'p1', data: { name: 'A', type: 'Personne physique' } },
      { entity: 'Holder', action: 'create', temp_id: 'p2', data: { name: 'B', type: 'Personne physique' } },
      { entity: 'HolderMember', action: 'create', parent_ref: 'c1', member_ref: 'p1', data: { share_percent: 60 } },
      { entity: 'HolderMember', action: 'create', parent_ref: 'c1', member_ref: 'p2', data: { share_percent: 50 } },
      { entity: 'Property', action: 'create', temp_id: 'prop1', data: { name: 'Bien' } },
      { entity: 'PropertyHolder', action: 'create', holder_ref: 'c1', data: { share_percent: 100 } },
    ];
    const { orderedTargets, errors } = resolveAndValidatePlan(targets, CTX());
    expect(errors.some((e) => /> 100%/.test(e.error))).toBe(true);
    // Les HolderMember bloqués ; le PropertyHolder référençant la société bloquée
    // est retiré par cascade (atomicité : pas de PropertyHolder orphelin).
    expect(orderedTargets.some((t) => t.entity === 'HolderMember')).toBe(false);
    expect(orderedTargets.some((t) => t.entity === 'PropertyHolder')).toBe(false);
    // Les Holder + Property non liés restent exécutables.
    expect(orderedTargets.some((t) => t.entity === 'Holder')).toBe(true);
    expect(orderedTargets.some((t) => t.entity === 'Property')).toBe(true);
  });

  it('applyResolvedRefs : résout temp_id → id réel pendant le commit', () => {
    const tempIdMap = { c1: 'real_c1', p1: 'real_p1' };
    const holders = [];
    const t = {
      entity: 'HolderMember', action: 'create',
      parent_ref: 'c1', member_ref: 'p1', data: { share_percent: 50 },
    };
    applyResolvedRefs(t, tempIdMap, { holders });
    expect(t.data.parent_holder_id).toBe('real_c1');
    expect(t.data.member_holder_id).toBe('real_p1');
  });
});

describe('commitEngine — cession & historique (legalEntityCommitPlan)', () => {
  const sci = holder('h_sci', 'SCI Test', 'SCI');
  const sophie = holder('h_sophie', 'Sophie');
  const paul = holder('h_paul', 'Paul');
  const existingMembers = [
    { id: 'm_sophie', parent_holder_id: 'h_sci', member_holder_id: 'h_sophie', share_percent: 50, exit_date: null, owner_id: 'u@u' },
  ];

  it('9/10. cession : ancienne relation conservée (exit_date) + nouvelle entrée (entry_date)', () => {
    const plan = legalEntityCommitPlan({
      ex: {
        company_name: 'SCI Test',
        seller: 'Sophie',
        buyer: 'Paul',
        share_percent: 50,
        effective_date: '2026-09-01',
        total_shares: 100,
        source_document_id: 'doc1',
      },
      conf: { seller: 0.9, buyer: 0.9, shares: 0.9 },
      context: { classification: 'cession_parts', holders: [sci, sophie, paul], members: existingMembers },
      document_meta: {},
    });
    // UPDATE de Sophie (exit_date), pas de suppression.
    const upd = plan.targets.find((t) => t.entity === 'HolderMember' && t.action === 'update');
    expect(upd).toBeTruthy();
    expect(upd.data.exit_date).toBe('2026-09-01');
    // CREATE de Paul (entry_date).
    const created = plan.targets.find((t) => t.entity === 'HolderMember' && t.action === 'create');
    expect(created).toBeTruthy();
    expect(created.data.entry_date).toBe('2026-09-01');
    // L'ancienne relation (id m_sophie) n'est jamais supprimée.
    expect(plan.targets.some((t) => t.entity === 'HolderMember' && t.action === 'delete')).toBe(false);
  });
});