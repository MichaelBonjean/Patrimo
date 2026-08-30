// Modèle canonique de détention imbriquée — algorithmes partagés (frontend).
// Miroir JS de base44/shared/ownership.ts. Graphe: HolderMember (parent_holder_id = structure,
// member_holder_id = associé, share_percent) + PropertyHolder (property_id, holder_id, share_percent).

export function memberChildrenOf(members, parentId) {
  return members.filter(m => m.parent_holder_id === parentId);
}

// Fraction de `target` ultimately possédée par `person`, avec garde anti-boucle sur le chemin d'expansion.
export function computeEconomicShare({ personId, targetId, members, path, warnings }) {
  path = path || new Set();
  warnings = warnings || [];
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
export function computePropertyShare({ personId, propertyId, members, propertyHolders, warnings }) {
  warnings = warnings || [];
  let total = 0;
  for (const link of propertyHolders.filter(l => l.property_id === propertyId)) {
    const direct = (link.share_percent || 0) / 100;
    total += direct * computeEconomicShare({ personId, targetId: link.holder_id, members, path: new Set(), warnings });
  }
  return total;
}

// Valeur économique totale d'un déteneur (personne ou structure) sur un portefeuille de biens.
export function computeHolderValue({ holderId, properties, members, propertyHolders }) {
  let value = 0;
  const detail = [];
  for (const prop of properties) {
    const propValue = prop.estimated_value || 0;
    if (propValue <= 0) continue;
    const share = computePropertyShare({ personId: holderId, propertyId: prop.id, members, propertyHolders });
    if (share > 0) {
      value += propValue * share;
      detail.push({ propertyId: prop.id, name: prop.name, share, value: propValue * share });
    }
  }
  return { value, detail };
}

// Pour une structure (SCI etc.), liste des associés directs et leur part économique dans la structure.
export function computeStructureMembers({ parentId, holders, members, structureValue }) {
  const children = memberChildrenOf(members, parentId);
  return children.map(m => {
    const h = holders.find(x => x.id === m.member_holder_id);
    const eco = computeEconomicShare({ personId: m.member_holder_id, targetId: parentId, members, path: new Set() });
    return {
      id: m.id,
      member_holder_id: m.member_holder_id,
      name: h?.name || 'Inconnu',
      type: h?.type || '—',
      share_percent: m.share_percent,
      economic_percent: Math.round(eco * 10000) / 100,
      value: structureValue != null ? structureValue * eco : null
    };
  });
}

export function detectCycles(members) {
  const warnings = [];
  const adj = {};
  for (const m of members) {
    if (!adj[m.parent_holder_id]) adj[m.parent_holder_id] = [];
    adj[m.parent_holder_id].push(m.member_holder_id);
  }
  const visited = new Set();
  const recStack = new Set();
  const dfs = (node, p) => {
    visited.add(node); recStack.add(node);
    for (const nb of (adj[node] || [])) {
      if (!visited.has(nb)) dfs(nb, [...p, nb]);
      else if (recStack.has(nb)) warnings.push({ type: 'cycle', path: [...p, nb] });
    }
    recStack.delete(node);
  };
  for (const n of Object.keys(adj)) if (!visited.has(n)) dfs(n, [n]);
  return warnings;
}

export function findOrphanMembers(members, holders) {
  const ids = new Set(holders.map(h => h.id));
  return members
    .filter(m => !ids.has(m.parent_holder_id) || !ids.has(m.member_holder_id))
    .map(m => ({
      id: m.id, parent: m.parent_holder_id, member: m.member_holder_id,
      missingParent: !ids.has(m.parent_holder_id), missingMember: !ids.has(m.member_holder_id)
    }));
}

// Répartition économique d'un bien entre toutes les personnes physiques (détention indirecte).
export function computePropertyOwnershipBreakdown({ propertyId, holders, members, propertyHolders }) {
  const warnings = [];
  const persons = holders.filter(h => !h.type || h.type === 'Personne physique');
  const rows = persons.map(p => ({
    personId: p.id,
    name: p.name || '',
    economic_percent: Math.round(
      computePropertyShare({ personId: p.id, propertyId, members, propertyHolders, warnings }) * 10000
    ) / 100,
  }));
  return { rows: rows.filter(r => r.economic_percent > 0), warnings };
}

// Détenteurs liés au patrimoine immobilier — source des chips du Dashboard.
// Miroir de base44/shared/ownership.ts. Ne pas recalculer la chaîne en React.
export function listPatrimonyHolders({ holders, members, propertyHolders }) {
  const hld = holders || [];
  const mem = members || [];
  const links = propertyHolders || [];
  const directCount = {};
  const linkedPropertyIds = new Set();
  for (const l of links) {
    directCount[l.holder_id] = (directCount[l.holder_id] || 0) + 1;
    linkedPropertyIds.add(l.property_id);
  }
  const directHolderIds = new Set(Object.keys(directCount));
  const entries = [];
  for (const h of hld) {
    const isPerson = h.type === 'Personne physique';
    if (!isPerson) {
      if (!directHolderIds.has(h.id)) continue;
      const dc = directCount[h.id] || 0;
      entries.push({ id: h.id, name: h.name || h.id, type: h.type || '', isPerson: false, directPropertyCount: dc, totalPropertyCount: dc });
    } else {
      let total = 0;
      for (const pid of Array.from(linkedPropertyIds)) {
        if (computePropertyShare({ personId: h.id, propertyId: pid, members: mem, propertyHolders: links }) > 0) total++;
      }
      if (total === 0) continue;
      const dc = directCount[h.id] || 0;
      entries.push({ id: h.id, name: h.name || h.id, type: h.type || '', isPerson: true, directPropertyCount: dc, totalPropertyCount: total });
    }
  }
  entries.sort((a, b) => {
    if (a.isPerson !== b.isPerson) return a.isPerson ? -1 : 1;
    return a.name.localeCompare(b.name, 'fr');
  });
  return entries;
}