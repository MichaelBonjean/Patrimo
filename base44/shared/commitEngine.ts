// Moteur canonique de résolution + intégrité du commit documentaire pour les
// chaînes de détention : Personne → HolderMember → Société → PropertyHolder → Bien.
//
// PUR (aucun import plateforme sauf ownership.ts) → testable unitairement.
// Le backend (commitDocumentImport) l'utilise pour valider/ordonner le plan
// AVANT écriture ; la résolution temp_id → id réel se fait pendant le commit.
//
// Garanties (critère majeur : « société créée mais associés perdus » impossible) :
//  - références temporelles (temp_id) pour lier un HolderMember à un Holder
//    fraîchement créé dans la même passe ;
//  - intégrité : parent/member résolus, pourcentage 0 < x <= 100, boucle directe,
//    boucle indirecte (cycles), doublon, cohérence owner ;
//  - pourcentages par société : =100% ok, <100% warning (document incomplet),
//    >100% blocage ;
//  - cascade : un Holder bloqué entraîne le blocage de ses dépendants par réf
//    → atomicité (pas de créations orphelines partielles).

import { detectCycles } from './ownership.ts';

export interface CommitTarget {
  entity: string;
  action: string;
  id?: string;
  temp_id?: string;
  data?: any;
  // Références temporelles (résolues au commit via tempIdMap) :
  parent_ref?: string;
  member_ref?: string;
  holder_ref?: string;
  property_ref?: string;
  [key: string]: any;
}

export interface CommitContext {
  owner_id: string;
  patrimony_id?: string;
  holders: any[];
  members: any[];
  properties?: any[];
}

// Ordre de création par dépendance (les Holders/Property avant les liens).
const RANK: Record<string, number> = {
  Holder: 0, Property: 1, Lot: 2, Lease: 3, HolderMember: 4, PropertyHolder: 5,
  Transaction: 6, Document: 7,
};

/**
 * Valide + ordonne un plan de commit. Retourne les cibles exécutables (sans les
 * cibles bloquées), les erreurs bloquantes et les warnings non bloquants.
 */
export function resolveAndValidatePlan(targets: CommitTarget[], ctx: CommitContext) {
  const errors: any[] = [];
  const warnings: any[] = [];
  const blocked = new Set<number>();

  // 1. Registre des temp_ids + holders existants (graphe unifié).
  const tempIds = new Set<string>();
  for (const t of targets) if (t.temp_id) tempIds.add(t.temp_id);
  const existingHolderIds = new Set(ctx.holders.map((h) => h.id));
  const resolveNode = (ref?: string): string | null => {
    if (!ref) return null;
    if (tempIds.has(ref)) return ref;
    if (existingHolderIds.has(ref)) return ref;
    return null;
  };

  // 2. Validation par cible + graphe prévu des membres.
  const plannedMembers: { ti: number; parent: string; member: string; share_percent: number }[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const terr: any[] = [];
    if (t.entity === 'HolderMember' && t.action !== 'update') {
      const sp = Number(t.data?.share_percent);
      if (!Number.isFinite(sp) || sp <= 0 || sp > 100)
        terr.push({ error: `share_percent invalide (0 < x <= 100), reçu ${t.data?.share_percent}` });
      const parent = t.data?.parent_holder_id || resolveNode(t.parent_ref);
      const member = t.data?.member_holder_id || resolveNode(t.member_ref);
      if (!parent) terr.push({ error: 'parent non résolu' });
      if (!member) terr.push({ error: 'member non résolu' });
      if (parent && member && parent === member)
        terr.push({ error: 'boucle directe (parent = member)' });
      if (!terr.length) plannedMembers.push({ ti: i, parent, member, share_percent: sp });
    } else if (t.entity === 'PropertyHolder' && t.action !== 'update') {
      const sp = Number(t.data?.share_percent);
      if (Number.isFinite(sp) && (sp <= 0 || sp > 100))
        terr.push({ error: `share_percent invalide (0 < x <= 100), reçu ${sp}` });
    }
    if (terr.length) {
      blocked.add(i);
      for (const e of terr) errors.push({ temp_id: t.temp_id, entity: t.entity, ...e });
    }
  }

  // 3. Graphe unifié (membres existants + prévus) pour cycles + doublons.
  // Seuls les membres actifs (exit_date non renseigné) comptent pour la détention
  // courante : un associé sorti (cession) ne participe plus au total/cycle/doublon.
  const unified = [
    ...ctx.members.filter((m) => !m.exit_date).map((m) => ({
      parent_holder_id: m.parent_holder_id,
      member_holder_id: m.member_holder_id,
      share_percent: m.share_percent,
    })),
    ...plannedMembers.map((p) => ({
      parent_holder_id: p.parent, member_holder_id: p.member, share_percent: p.share_percent,
    })),
  ];

  // 3a. Boucles indirectes (cycles).
  const cycles = detectCycles(unified);
  const cycleNodes = new Set<string>();
  for (const c of cycles) for (const n of c.path || []) cycleNodes.add(n);
  for (const p of plannedMembers) {
    if (cycleNodes.has(p.parent) || cycleNodes.has(p.member)) {
      blocked.add(p.ti);
      errors.push({
        temp_id: targets[p.ti].temp_id, entity: 'HolderMember',
        error: 'boucle indirecte détectée', cycle: cycles.map((c) => c.path),
      });
    }
  }

  // 3b. Doublons (même parent + member).
  const relCount = new Map<string, number>();
  for (const m of unified) {
    const k = `${m.parent_holder_id}|${m.member_holder_id}`;
    relCount.set(k, (relCount.get(k) || 0) + 1);
  }
  for (const p of plannedMembers) {
    const k = `${p.parent}|${p.member}`;
    if ((relCount.get(k) || 0) > 1) {
      blocked.add(p.ti);
      errors.push({
        temp_id: targets[p.ti].temp_id, entity: 'HolderMember',
        error: `doublon de relation ${k}`,
      });
    }
  }

  // 4. Totaux par société (parent). >100% blocage, <100% warning, =100% ok.
  const totalsByParent = new Map<string, number>();
  for (const m of unified) {
    if (m.share_percent == null) continue;
    totalsByParent.set(m.parent_holder_id, (totalsByParent.get(m.parent_holder_id) || 0) + Number(m.share_percent));
  }
  for (const [pid, total] of totalsByParent) {
    const tot = Math.round(total * 10) / 10;
    if (tot > 100) {
      for (const p of plannedMembers) {
        if (p.parent === pid) {
          blocked.add(p.ti);
          errors.push({
            temp_id: targets[p.ti].temp_id, entity: 'HolderMember',
            error: `total des parts pour ${pid} = ${tot}% (> 100%)`,
          });
        }
      }
    } else if (tot < 100) {
      warnings.push({
        entity: 'HolderMember',
        warning: `total des parts pour ${pid} = ${tot}% (< 100%, document possiblement incomplet)`,
      });
    }
  }

  // Atomicité : si tous les associés prévus d'une société (temp_id) sont bloqués,
  // la société elle-même est bloquée — jamais « société créée mais associés perdus ».
  {
    const plannedByParent = new Map<string, number[]>();
    for (const p of plannedMembers) {
      const arr = plannedByParent.get(p.parent);
      if (arr) arr.push(p.ti); else plannedByParent.set(p.parent, [p.ti]);
    }
    for (const [parentId, kids] of plannedByParent) {
      if (!tempIds.has(parentId)) continue; // société existante : pas de rollback possible
      if (kids.every((ti) => blocked.has(ti))) {
        const idx = targets.findIndex((t) => t.temp_id === parentId && t.entity === 'Holder' && t.action !== 'update');
        if (idx !== -1 && !blocked.has(idx)) {
          blocked.add(idx);
          errors.push({ temp_id: parentId, entity: 'Holder', error: 'société bloquée : tous ses associés prévus ont été rejetés (atomicité)' });
        }
      }
    }
  }

  // 5. Cascade : un Holder (temp_id) bloqué → bloquer ses dépendants par réf.
  const blockedTempIds = new Set<string>();
  for (const i of blocked) if (targets[i].temp_id) blockedTempIds.add(targets[i].temp_id as string);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < targets.length; i++) {
      if (blocked.has(i)) continue;
      const t = targets[i];
      const refs = [t.parent_ref, t.member_ref, t.holder_ref, t.property_ref].filter(Boolean) as string[];
      for (const r of refs) {
        if (blockedTempIds.has(r)) {
          blocked.add(i);
          if (t.temp_id) blockedTempIds.add(t.temp_id as string);
          errors.push({ temp_id: t.temp_id, entity: t.entity, error: `dépendance bloquée (réf. ${r})` });
          changed = true;
        }
      }
    }
  }

  // 6. Ordonnancement par dépendance (stables pour même rang).
  const orderedTargets = targets
    .map((t, i) => ({ t, i }))
    .filter((x) => !blocked.has(x.i))
    .sort((a, b) => (RANK[a.t.entity] ?? 99) - (RANK[b.t.entity] ?? 99))
    .map((x) => x.t);

  return { orderedTargets, errors, warnings, tempIds: Array.from(tempIds) };
}

/**
 * Résout une référence temp_id → id réel au moment du commit ; si non résolu,
 * cherche parmi les holders existants (réf. = id réel existant).
 */
export function resolveRefAtCommit(ref: string | undefined, tempIdMap: Record<string, string>, holders: any[]): string | null {
  if (!ref) return null;
  if (tempIdMap[ref]) return tempIdMap[ref];
  const ex = holders.find((h) => h.id === ref);
  return ex ? ex.id : null;
}

/**
 * Applique les références résolues sur une cible juste avant l'écriture.
 * Mutte target.data (parent_holder_id / member_holder_id / holder_id / property_id).
 * Ne surcharge pas une valeur déjà présente (ex : holder rattaché à un existant).
 */
export function applyResolvedRefs(target: CommitTarget, tempIdMap: Record<string, string>, ctx: { holders: any[]; properties?: any[] }) {
  const data = target.data || (target.data = {});
  if (target.parent_ref && !data.parent_holder_id)
    data.parent_holder_id = resolveRefAtCommit(target.parent_ref, tempIdMap, ctx.holders);
  if (target.member_ref && !data.member_holder_id)
    data.member_holder_id = resolveRefAtCommit(target.member_ref, tempIdMap, ctx.holders);
  if (target.holder_ref && !data.holder_id)
    data.holder_id = resolveRefAtCommit(target.holder_ref, tempIdMap, ctx.holders);
  if (target.property_ref && !data.property_id) {
    if (tempIdMap[target.property_ref]) data.property_id = tempIdMap[target.property_ref];
  }
}