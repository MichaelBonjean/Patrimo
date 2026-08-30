// Modèle canonique de détention imbriquée — algorithmes partagés (backend).
// Graphe: HolderMember (parent_holder_id = structure, member_holder_id = associé, share_percent).
// PropertyHolder (property_id, holder_id, share_percent) relie un déteneur (structure ou personne) à un bien.
//
// Fraction économique d'une `person` sur un `target` (un déteneur):
//   ownership(person, target) = 1 si person === target
//                             = somme sur les membres de `target` (parent=target) de
//                               (share_percent/100) * ownership(person, member_holder_id)
// Fraction économique d'une `person` sur un bien:
//   somme sur PropertyHolder du bien de (share_percent/100) * ownership(person, holder_id)
// Détection de cycles: un déteneur qui remonte à lui-même dans la chaîne d'associés.

export interface Holder { id: string; owner_id?: string; name?: string; type?: string; is_demo?: boolean; created_by?: string; }
export interface HolderMember { id: string; parent_holder_id: string; member_holder_id: string; share_percent: number; owner_id?: string; }
export interface PropertyHolder { id: string; property_id: string; holder_id: string; share_percent: number; }

export function memberChildrenOf(members: HolderMember[], parentId: string): HolderMember[] {
  return members.filter(m => m.parent_holder_id === parentId);
}

// Fraction de `target` ultimately possédée par `person`, avec garde anti-boucle sur le chemin d'expansion.
export function computeEconomicShare(opts: {
  personId: string;
  targetId: string;
  members: HolderMember[];
  path?: Set<string>;
  warnings?: any[];
}): number {
  const { personId, targetId, members } = opts;
  const path = opts.path || new Set<string>();
  const warnings = opts.warnings || [];
  if (personId === targetId) return 1;
  if (path.has(targetId)) {
    warnings.push({ type: 'cycle', targetId, path: Array.from(path) });
    return 0;
  }
  path.add(targetId);
  let total = 0;
  for (const m of members.filter(x => x.parent_holder_id === targetId)) {
    const s = (m.share_percent || 0) / 100;
    total += s * computeEconomicShare({ personId, targetId: m.member_holder_id, members, path, warnings });
  }
  path.delete(targetId);
  return total;
}

// Fraction économique d'une personne sur un bien (0..1).
export function computePropertyShare(opts: {
  personId: string;
  propertyId: string;
  members: HolderMember[];
  propertyHolders: PropertyHolder[];
  warnings?: any[];
}): number {
  const warnings = opts.warnings || [];
  let total = 0;
  for (const link of opts.propertyHolders.filter(l => l.property_id === opts.propertyId)) {
    const direct = (link.share_percent || 0) / 100;
    total += direct * computeEconomicShare({
      personId: opts.personId, targetId: link.holder_id, members: opts.members, warnings
    });
  }
  return total;
}

// Répartition économique d'un bien entre toutes les personnes physiques.
export function computePropertyOwnershipBreakdown(opts: {
  propertyId: string;
  holders: Holder[];
  members: HolderMember[];
  propertyHolders: PropertyHolder[];
}): { personId: string; name: string; economic_percent: number; warnings: any[] } {
  const warnings: any[] = [];
  const persons = opts.holders.filter(h => h.type === 'Personne physique');
  const rows = persons.map(p => ({
    personId: p.id,
    name: p.name || '',
    economic_percent: Math.round(
      computePropertyShare({
        personId: p.id, propertyId: opts.propertyId,
        members: opts.members, propertyHolders: opts.propertyHolders, warnings
      }) * 10000
    ) / 100
  }));
  return { rows: rows.filter(r => r.economic_percent > 0), warnings };
}

// Détection de cycles dans le graphe des membres (DFS).
export function detectCycles(members: HolderMember[]): any[] {
  const warnings: any[] = [];
  const adj: Record<string, string[]> = {};
  for (const m of members) {
    if (!adj[m.parent_holder_id]) adj[m.parent_holder_id] = [];
    adj[m.parent_holder_id].push(m.member_holder_id);
  }
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const dfs = (node: string, path: string[]) => {
    visited.add(node);
    recStack.add(node);
    for (const nb of (adj[node] || [])) {
      if (!visited.has(nb)) dfs(nb, [...path, nb]);
      else if (recStack.has(nb)) warnings.push({ type: 'cycle', path: [...path, nb] });
    }
    recStack.delete(node);
  };
  for (const n of Object.keys(adj)) if (!visited.has(n)) dfs(n, [n]);
  return warnings;
}

// Membres orphelins: parent ou member introuvable parmi les holders.
export function findOrphanMembers(members: HolderMember[], holders: Holder[]): any[] {
  const ids = new Set(holders.map(h => h.id));
  return members
    .filter(m => !ids.has(m.parent_holder_id) || !ids.has(m.member_holder_id))
    .map(m => ({
      id: m.id,
      parent: m.parent_holder_id,
      member: m.member_holder_id,
      missingParent: !ids.has(m.parent_holder_id),
      missingMember: !ids.has(m.member_holder_id)
    }));
}

// Cohérence owner_id: tout HolderMember/PropertyHolder doit partager le owner_id de son déteneur.
export function findOwnerIncoherences(opts: {
  holders: Holder[]; members: HolderMember[]; propertyHolders: PropertyHolder[];
}): any[] {
  const holderOwner = new Map(opts.holders.map(h => [h.id, h.owner_id]));
  const issues: any[] = [];
  for (const m of opts.members) {
    const po = holderOwner.get(m.parent_holder_id);
    const mo = holderOwner.get(m.member_holder_id);
    if (po && m.owner_id && po !== m.owner_id)
      issues.push({ kind: 'HolderMember', id: m.id, reason: 'parent_owner_mismatch', expected: po, actual: m.owner_id });
    if (mo && m.owner_id && mo !== m.owner_id)
      issues.push({ kind: 'HolderMember', id: m.id, reason: 'member_owner_mismatch', expected: mo, actual: m.owner_id });
  }
  return issues;
}

// Détenteurs liés au patrimoine immobilier — source des chips du Dashboard.
// Règles (cf. moteur de détention canonique, jamais recalculé côté React) :
//  - Structure (SCI/SARL…) : affichée si elle détient DIRECTEMENT au moins un bien
//    (présente comme holder_id dans PropertyHolder).
//  - Personne physique : affichée si elle détient directement un bien OU indirectement
//    via une chaîne de structures (computePropertyShare > 0 sur au moins un bien).
//  - Structures intermédiaires sans lien direct avec un actif : exclues.
export interface PatrimonyHolderEntry {
  id: string;
  name: string;
  type: string;
  isPerson: boolean;
  directPropertyCount: number;
  totalPropertyCount: number;
}

export function listPatrimonyHolders(opts: {
  holders: Holder[];
  members: HolderMember[];
  propertyHolders: PropertyHolder[];
}): PatrimonyHolderEntry[] {
  const holders = opts.holders || [];
  const members = opts.members || [];
  const links = opts.propertyHolders || [];
  const directCount: Record<string, number> = {};
  const linkedPropertyIds = new Set<string>();
  for (const l of links) {
    directCount[l.holder_id] = (directCount[l.holder_id] || 0) + 1;
    linkedPropertyIds.add(l.property_id);
  }
  const directHolderIds = new Set<string>(Object.keys(directCount));

  const entries: PatrimonyHolderEntry[] = [];
  for (const h of holders) {
    const isPerson = h.type === 'Personne physique';
    if (!isPerson) {
      if (!directHolderIds.has(h.id)) continue;
      const dc = directCount[h.id] || 0;
      entries.push({
        id: h.id, name: h.name || h.id, type: h.type || '',
        isPerson: false, directPropertyCount: dc, totalPropertyCount: dc,
      });
    } else {
      let total = 0;
      for (const pid of linkedPropertyIds) {
        if (computePropertyShare({ personId: h.id, propertyId: pid, members, propertyHolders: links }) > 0) total++;
      }
      if (total === 0) continue;
      const dc = directCount[h.id] || 0;
      entries.push({
        id: h.id, name: h.name || h.id, type: h.type || '',
        isPerson: true, directPropertyCount: dc, totalPropertyCount: total,
      });
    }
  }
  entries.sort((a, b) => {
    if (a.isPerson !== b.isPerson) return a.isPerson ? -1 : 1;
    return a.name.localeCompare(b.name, 'fr');
  });
  return entries;
}