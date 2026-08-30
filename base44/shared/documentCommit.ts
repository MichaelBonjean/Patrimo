// Moteur CANONIQUE du pipeline « Document First » de Patrimo (source unique de vérité).
// Moteur PUR : importe uniquement loanEngine (pur). Utilisé par le backend
// (commitDocumentImport / proposeDocumentCommit), les tests, et le frontend via
// la façade src/lib/documentCommit.js (ré-export, aucune règle métier dupliquée).

import { buildSchedule, computeMonthlyPayment, scheduleTotals } from './loanEngine.ts';

export const CLASSIFICATION_TYPES = [
  'bail_alur', 'acte_vente_notarie', 'offre_pret_bancaire', 'tableau_amortissement',
  'releve_bancaire', 'diagnostic_technique', 'sci_statuts_kbis',
  'statuts_societe', 'kbis_societe', 'cession_parts', 'pv_assemblee',
  'augmentation_capital', 'quittance_loyer', 'autre', 'unknown',
];

export const LEGAL_ENTITY_TYPES = new Set([
  'sci_statuts_kbis', 'statuts_societe', 'kbis_societe', 'cession_parts',
  'pv_assemblee', 'pv_societe', 'augmentation_capital', 'reduction_capital',
  'beneficiaires_effectifs',
]);
export function isLegalEntity(type: string): boolean { return LEGAL_ENTITY_TYPES.has(type); }

const DOC_TYPE_BY_CLASS: Record<string, string> = {
  bail_alur: 'bail', acte_vente_notarie: 'acte', offre_pret_bancaire: 'pret',
  tableau_amortissement: 'pret', releve_bancaire: 'releve_bancaire',
  diagnostic_technique: 'dpe', sci_statuts_kbis: 'ag_copropriete',
  statuts_societe: 'ag_copropriete', kbis_societe: 'ag_copropriete',
  cession_parts: 'ag_copropriete', pv_assemblee: 'ag_copropriete',
  augmentation_capital: 'ag_copropriete',
  pv_societe: 'ag_copropriete', reduction_capital: 'ag_copropriete', beneficiaires_effectifs: 'ag_copropriete',
  quittance_loyer: 'quittance', autre: 'autre', unknown: 'autre',
};

const SENSITIVE_FIELDS = new Set([
  'tenant_name', 'purchase_price', 'loan_amount', 'rent_excluding_charges',
  'deposit', 'capital', 'company_name', 'siret', 'siren', 'legal_form',
  'total_shares', 'representative_name', 'shares', 'associates',
  'seller', 'buyer', 'shares_transferred', 'beneficial_owners',
]);

const HIGH = 0.85;
const FIELD_DEFAULT = 0.5;

export function norm(s: any): string {
  if (s == null) return '';
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normAddr(s: any): string {
  return norm(s).replace(/\bfrance\b/g, '').replace(/\bcommune de\b/g, '').replace(/\bvoie\b/g, '').trim();
}

function contains(hay: string, needle: string): boolean {
  if (!needle) return false;
  if (hay.includes(needle)) return true;
  const nt = needle.split(' ').filter(Boolean);
  if (!nt.length) return false;
  const hits = nt.filter((t) => t.length > 2 && hay.includes(t)).length;
  return hits / nt.length >= 0.6;
}

export function matchPropertyByAddress(address: any, properties: any[] = []): any {
  const na = normAddr(address);
  if (!na) return null;
  let best: any = null; let bestScore = 0;
  for (const p of properties) {
    const hay = normAddr([p.address, p.postal_code, p.city, p.name].filter(Boolean).join(' '));
    if (!hay) continue;
    let score = 0;
    if (hay === na) score = 1;
    else if (contains(hay, na) || contains(na, hay)) score = 0.85;
    if (p.postal_code && address && norm(String(address)).includes(norm(String(p.postal_code)))) score = Math.max(score, 0.6);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return bestScore >= 0.6 ? { property: best, score: bestScore } : null;
}

export function matchLeaseByTenant(tenantName: any, leases: any[] = []): any {
  const nt = norm(tenantName);
  if (!nt) return null;
  for (const l of leases) {
    const tenants = (l.tenants || []).map((t: any) => norm(t.name)).filter(Boolean);
    if (!tenants.length) continue;
    if (tenants.some((t: string) => t === nt)) return { lease: l, score: 1 };
  }
  for (const l of leases) {
    const tenants = (l.tenants || []).map((t: any) => norm(t.name)).filter(Boolean);
    if (tenants.some((t: string) => t.includes(nt) || nt.includes(t))) return { lease: l, score: 0.7 };
  }
  return null;
}

function matchLotInProperty(property: any, lots: any[] = []): any {
  const propLots = lots.filter((l) => l.property_id === property.id);
  return propLots.length === 1 ? propLots[0] : null;
}

function fieldConf(field: string, conf: any): number {
  const v = conf?.[field];
  const n = Number(v);
  if (!Number.isNaN(n) && v != null) return Math.max(0, Math.min(1, n));
  return FIELD_DEFAULT;
}
function minConf(fields: string[], conf: any): number {
  const vals = fields.map((f) => fieldConf(f, conf));
  return vals.length ? Math.min(...vals) : FIELD_DEFAULT;
}

export function buildCommitPlan(args: any = {}): any {
  const classification = args.classification || 'unknown';
  const ex = args.extracted_data || {};
  const conf = args.confidence_per_field || {};
  const classConf = Number(args.classification_confidence) || 0;
  const ctx = args.context || {};
  const properties = ctx.properties || [];
  const lots = ctx.lots || [];
  const leases = ctx.leases || [];

  const targets: any[] = [];
  const riskNotes: string[] = [];
  const document_meta: any = {
    type: DOC_TYPE_BY_CLASS[classification] || 'autre',
    title: ex.title || ex.document_title || null,
    document_date: ex.date || ex.invoice_date || ex.dpe_date || ex.acquisition_date || null,
    expiration_date: ex.expiration_date || null,
    amount: ex.amount != null ? ex.amount : (ex.amount_ttc != null ? ex.amount_ttc : ex.total),
    supplier: ex.supplier || ex.supplier_name || ex.bank || ex.notary || null,
  };

  const addT = (t: any) => targets.push(t);

  switch (classification) {
    case 'bail_alur': {
      const r = leaseCommitPlan({ ex, conf, context: ctx, document_meta });
      for (const t of r.targets) addT(t);
      for (const n of r.riskNotes) riskNotes.push(n);
      break;
    }
    case 'acte_vente_notarie': {
      const r = acteDeVenteCommitPlan({ ex, conf, context: ctx, document_meta });
      for (const t of r.targets) addT(t);
      for (const n of r.riskNotes) riskNotes.push(n);
      break;
    }
    case 'offre_pret_bancaire':
    case 'tableau_amortissement': {
      // Le rapprochement prêt est désormais intégralement géré par loanCommitPlan
      // (rattachement au bien, comparaison moteur vs contractuel, document_meta.loan_meta).
      const r = loanCommitPlan({ ex, conf, context: { ...ctx, classification }, document_meta });
      for (const t of r.targets) addT(t);
      for (const n of r.riskNotes) riskNotes.push(n);
      // Bloc legacy ci-dessous (inerte) — loanCommitPlan pousse toujours une cible
      // Property (rattachée ou à sélectionner), donc cette branche ne s'exécute jamais.
      if (!r.targets.length) {
        riskNotes.push('Prêt sans bien identifié : l’utilisateur doit choisir le bien cible.');
      }
      break;
    }
    case 'diagnostic_technique': {
      const m = matchPropertyByAddress(ex.address, properties);
      const lot = m ? matchLotInProperty(m.property, lots) : null;
      if (lot) {
        addT({ entity: 'Lot', action: 'update', id: lot.id, data: dpePatch(ex, lot), confidence: 0.85, needs_review: false, reason: `DPE appliqué au lot « ${lot.designation || ''} »` });
        document_meta.property_id = m.property.id; document_meta.lot_id = lot.id;
      } else if (m) {
        addT({ entity: 'Property', action: 'update', id: m.property.id, data: {}, confidence: 0.6, needs_review: true, reason: 'DPE sans lot unique — bien reconnu, lot à préciser' });
        document_meta.property_id = m.property.id; riskNotes.push('Plusieurs lots : préciser le lot concerné.');
      } else {
        addT({ entity: 'Document', action: 'create', data: {}, confidence: 0.4, needs_review: true, reason: 'DPE non rattaché — bien à préciser manuellement' });
        riskNotes.push('Adresse du DPE non reconnue.');
      }
      break;
    }
    case 'sci_statuts_kbis':
    case 'statuts_societe':
    case 'kbis_societe':
    case 'cession_parts':
    case 'pv_assemblee':
    case 'pv_societe':
    case 'augmentation_capital':
    case 'reduction_capital':
    case 'beneficiaires_effectifs': {
      const r = legalEntityCommitPlan({ ex, conf, context: { ...ctx, classification }, document_meta });
      for (const t of r.targets) addT(t);
      for (const n of r.riskNotes) riskNotes.push(n);
      break;
    }
    case 'releve_bancaire': {
      riskNotes.push('Relevé bancaire : utiliser l’import bancaire pour le rapprochement.');
      break;
    }
    case 'quittance_loyer': {
      const m = ex.tenant_name ? matchLeaseByTenant(ex.tenant_name, leases) : null;
      if (m) {
        document_meta.lease_id = m.lease.id; document_meta.lot_id = m.lease.lot_id;
        document_meta.property_id = m.lease.property_id; document_meta.tenant_name = ex.tenant_name;
        document_meta.tenant_id = (m.lease.tenants || [])[0]?.id || null;
      }
      break;
    }
    default: {
      addT({ entity: 'Document', action: 'create', data: {}, confidence: 0.3, needs_review: true, reason: 'Document non classé — à catégoriser manuellement' });
      break;
    }
  }

  const hasSensitive = Object.keys(ex).some((k) => SENSITIVE_FIELDS.has(k) && ex[k] != null && ex[k] !== '');
  if (hasSensitive) {
    for (const t of targets) if (t.action === 'create' || t.action === 'update') t.needs_review = true;
  }

  const needsReview = classConf < HIGH || targets.some((t) => t.needs_review) || targets.length === 0 || riskNotes.length > 0;

  return { targets, document_meta, needs_review: needsReview, risk_notes: riskNotes };
}

function leasePatch(ex: any, existingLease: any, lotId?: any, propertyId?: any): any {
  const tenants = (existingLease?.tenants && existingLease.tenants.length)
    ? existingLease.tenants
    : [{ name: ex.tenant_name || 'Locataire', email: ex.tenant_email || '', phone: ex.tenant_phone || '', entry_date: ex.date_start || ex.tenant_entry_date || '' }];
  return {
    ...(propertyId ? { property_id: propertyId } : {}),
    ...(lotId ? { lot_id: lotId } : {}),
    lease_type: ex.lease_type || existingLease?.lease_type || 'Vide-Nu',
    date_start: ex.date_start || ex.date || existingLease?.date_start,
    date_end: ex.date_end || existingLease?.date_end || undefined,
    rent_excluding_charges: num(ex.rent_excluding_charges),
    charges: num(ex.charges) || 0,
    deposit: num(ex.deposit) || 0,
    due_day: num(ex.due_day) || 5,
    tenants, furnished: /meubl/i.test(ex.lease_type || ''),
  };
}
function propertyPatchFromBail(ex: any): any {
  const addr = ex.address || '';
  const { postal_code, city, street } = splitAddress(addr);
  return { name: ex.property_name || `Bien ${city || addr || ''}`.trim(), address: street || addr, postal_code, city, category: ex.category || undefined, holding_structure: ex.holding_structure || undefined, tax_regime: ex.tax_regime || undefined };
}
function propertyPatchFromDeed(ex: any, prop: any): any {
  const { postal_code, city, street } = splitAddress(ex.address || '');
  const cadastral: any = Array.isArray(ex.cadastral_references)
    ? ex.cadastral_references.filter(Boolean).join(', ')
    : (ex.cadastral_references || '');
  return {
    name: prop?.name || ex.name || `Bien ${city || ex.city || ''}`.trim() || 'Bien',
    address: prop?.address || street || ex.address || '',
    postal_code: prop?.postal_code || postal_code || ex.postal_code || '',
    city: prop?.city || city || ex.city || '',
    purchase_price: num(ex.purchase_price) || prop?.purchase_price,
    notary_fees: num(ex.notary_fees) || prop?.notary_fees,
    agency_fees: num(ex.agency_fees) || prop?.agency_fees,
    acquisition_date: ex.acquisition_date || ex.date || prop?.acquisition_date,
    total_surface: num(ex.total_surface) || num(ex.surface) || prop?.total_surface,
    notary_contact: ex.notary || prop?.notary_contact || '',
    holding_structure: ex.holding_structure || prop?.holding_structure,
    category: ex.category || prop?.category,
    // On NE DÉDUIT JAMAIS le régime fiscal de l'acte : seule une valeur explicite
    // de l'acte override ; sinon on garde la valeur existante (jamais de défaut inventé).
    tax_regime: ex.tax_regime || prop?.tax_regime,
    ...(cadastral
      ? { notes: [prop?.notes, `Références cadastrales : ${cadastral}`].filter(Boolean).join('\n') }
      : {}),
  };
}

// --- ActeDeVenteProcessor ----------------------------------------------------

export function matchHolderByName(name: any, holders: any[] = []): any {
  const n = norm(name);
  if (!n) return null;
  for (const h of holders) {
    if (norm(h.name) === n) return h;
  }
  for (const h of holders) {
    const hn = norm(h.name);
    if (hn && (hn.includes(n) || n.includes(hn))) return h;
  }
  return null;
}

function mapLotType(t: any): any {
  const s = String(t || '').toLowerCase();
  if (s.includes('cave')) return 'Cave';
  if (s.includes('garage')) return 'Garage';
  if (s.includes('box')) return 'Box';
  if (s.includes('parking')) return 'Parking';
  if (s.includes('local commercial')) return 'Local commercial';
  return undefined;
}

function lotDefaultDesignation(lot: any): string {
  const t = lot.type || lot.typology || '';
  if (/cave/i.test(t)) return 'Cave';
  if (/garage/i.test(t)) return 'Garage';
  if (/parking/i.test(t)) return 'Parking';
  if (/box/i.test(t)) return 'Box';
  return lot.code || lot.lot_number ? `Lot ${lot.code || lot.lot_number}` : 'Logement';
}

function lotPatchFromDeed(lot: any, propertyId: any): any {
  const typ = mapLotType(lot.type || lot.typology);
  return {
    ...(propertyId ? { property_id: propertyId } : {}),
    designation: lot.designation || lotDefaultDesignation(lot),
    code: lot.code || lot.lot_number || undefined,
    typology: typ,
    surface: num(lot.surface) || undefined,
  };
}

function lotReason(lot: any): string {
  const t = (lot.type || lot.typology || '').toLowerCase();
  if (t.includes('cave')) return 'Cave issue de l’acte';
  if (t.includes('garage')) return 'Garage issu de l’acte';
  if (t.includes('parking')) return 'Parking issu de l’acte';
  if (t.includes('box')) return 'Box issu de l’acte';
  return 'Lot de copropriété issu de l’acte';
}

/**
 * ActeDeVenteProcessor — plan de commit robuste pour l'acte de vente notarié.
 *  - matching du bien par adresse (update si probable, création sinon) ;
 *  - création des lots de copropriété mentionnés (logement, cave, garage, parking, box) ;
 *  - détention (Holder + PropertyHolder) UNIQUEMENT si acquéreurs + quotes-parts
 *    suffisamment fiables (confiance >= 0.7) ;
 *  - NE DÉDUIT JAMAIS régime fiscal / LMNP / SCI IS·IR / données absentes ;
 *  - le Document original reste lié au Property (document_meta.property_id).
 */
export function acteDeVenteCommitPlan(args: any): any {
  const ex = args.ex || {};
  const conf = args.conf || {};
  const ctx = args.context || {};
  const properties = ctx.properties || [];
  const holders = ctx.holders || [];
  const document_meta = args.document_meta;
  const targets: any[] = [];
  const riskNotes: string[] = [];
  const addT = (t: any) => targets.push(t);

  // Traçabilité de l'import (objectif #5) — propagée aux cibles qui supportent
  // source_document_id / source_page (PropertyHolder). Propres au document source.
  const source_document_id = ex.source_document_id || null;
  const source_page = num(ex.source_page);

  // Références temporelles pour les acquéreurs nouvellement créés (Holder ->
  // PropertyHolder via holder_ref). Résolues par commitDocumentImport.
  let _buyerSeq = 0;
  const _nextBuyerTemp = () => `buyer_${++_buyerSeq}`;

  const street = ex.address_street || '';
  const addr = ex.address || [street, ex.postal_code, ex.city].filter(Boolean).join(' ').trim();
  const m = addr ? matchPropertyByAddress(addr, properties) : null;
  let propertyId: any = null;

  if (m) {
    propertyId = m.property.id;
    addT({
      entity: 'Property', action: 'update', id: m.property.id,
      data: propertyPatchFromDeed(ex, m.property),
      confidence: Math.min(m.score, minConf(['purchase_price', 'address', 'acquisition_date'], conf)),
      needs_review: true,
      reason: `Ce document semble concerner votre bien « ${m.property.name || m.property.city || ''} » — complément des données d'acquisition.`,
    });
    if (document_meta) document_meta.property_id = m.property.id;
  } else {
    addT({
      entity: 'Property', action: 'create',
      data: propertyPatchFromDeed(ex, null),
      confidence: 0.7, needs_review: true,
      reason: 'Acte de vente — création du bien à valider',
      _await_property_id: true,
    });
    if (!addr) {
      riskNotes.push('Adresse manquante dans l’acte — bien créé sans localisation, à compléter.');
    } else {
      riskNotes.push('Bien non reconnu : création proposée. Vérifiez qu’il ne s’agit pas d’un bien existant.');
    }
  }

  const coproLots: any[] = Array.isArray(ex.copro_lots) ? ex.copro_lots
    : (Array.isArray(ex.lots) ? ex.lots : (ex.lot ? [ex.lot] : []));
  if (coproLots.length) {
    const lotConf = conf?.copro_lots != null ? fieldConf('copro_lots', conf) : 0.7;
    for (const lot of coproLots) {
      if (!lot || (!lot.designation && !lot.type && !lot.typology && !lot.code && !lot.lot_number)) continue;
      addT({
        entity: 'Lot', action: 'create',
        data: lotPatchFromDeed(lot, propertyId),
        confidence: lotConf,
        needs_review: true,
        reason: lotReason(lot),
        _await_property_id: !propertyId,
      });
    }
  }

  const buyers: any[] = Array.isArray(ex.buyers) ? ex.buyers
    : (ex.buyer ? [{ name: ex.buyer, share_percent: ex.share_percent }] : []);
  const buyerConf = Math.min(fieldConf('buyers', conf), fieldConf('shares', conf));
  if (buyers.length && buyerConf >= 0.7) {
    for (const b of buyers) {
      if (!b?.name) continue;
      const isMoralBuyer = b.type === 'personne_morale' || !!b.siren
        || /sci|sarl|sasu|eurl|holding|societe/i.test(b.name || '');
      let holderId: any = null;
      let hm: any = null;
      if (isMoralBuyer) {
        const lm = matchLegalEntity({ siren: b.siren, company_name: b.name, registered_office: b.address }, holders);
        if (lm && lm.holder) { hm = lm.holder; holderId = lm.holder.id; }
      }
      if (!hm) hm = matchHolderByName(b.name, holders);
      const buyerTemp = hm ? null : _nextBuyerTemp();
      const holderType = isMoralBuyer
        ? (mapLegalType(b.name) || (b.siren ? 'Société civile' : 'SCI'))
        : 'Personne physique';
      addT({
        entity: 'Holder', action: hm ? 'update' : 'create',
        ...(hm ? { id: hm.id } : {}),
        data: { name: b.name, type: holderType, ...(b.siren ? { siren: b.siren } : {}) },
        temp_id: buyerTemp || undefined,
        confidence: buyerConf, needs_review: true,
        reason: `Acquéreur « ${b.name} » — détention ${b.share_percent != null ? b.share_percent + '%' : 'à préciser'}${hm ? ' (structure existante réutilisée)' : ''}`,
      });
      const share = num(b.share_percent);
      const sharePct = Number.isFinite(share) ? share : (buyers.length === 1 ? 100 : undefined);
      addT({
        entity: 'PropertyHolder', action: 'create',
        data: {
          ...(propertyId ? { property_id: propertyId } : {}),
          ...(holderId ? { holder_id: holderId } : { _holder_name: b.name }),
          share_percent: sharePct,
          entry_date: ex.acquisition_date || ex.date || undefined,
          ...(source_document_id ? { source_document_id } : {}),
          ...(source_page != null ? { source_page } : {}),
        },
        holder_ref: buyerTemp || undefined,
        confidence: buyerConf, needs_review: true,
        reason: `Quote-part ${sharePct != null ? sharePct + '%' : ''} — « ${b.name} »${holderId ? ' rattachée à la société existante' : ''}`,
        _await_property_id: !propertyId,
      });
    }
  } else if (buyers.length) {
    riskNotes.push('Acquéreurs détectés mais fiabilité insuffisante — détention non créée automatiquement.');
  }

  if (!ex.tax_regime && !ex.holding_structure) {
    riskNotes.push('Régime fiscal et structure de détention non déduits de l’acte — à renseigner.');
  }

  return { targets, riskNotes };
}
// --- LeaseDocumentProcessor --------------------------------------------------

function inferLeaseType(ex: any): string {
  const t = norm([ex.lease_type, ex.title, ex.document_title].filter(Boolean).join(' ')) || '';
  if (ex.furnished === true) return 'Meublé';
  if (/meubl/.test(t)) return 'Meublé';
  if (/mobilite/.test(t)) return 'Bail mobilité';
  if (/etudiant/.test(t)) return 'Bail étudiant';
  if (/commercial/.test(t)) return 'Bail commercial';
  if (/saisonnier|airbnb/.test(t)) return 'Saisonnier-Airbnb';
  return 'Vide-Nu';
}

function matchLotByDesignation(property: any, ex: any, lots: any[] = []): any {
  const propLots = lots.filter((l) => l.property_id === property.id);
  if (!propLots.length) return null;
  const code = norm(ex.lot_code || ex.code || ex.lot_number);
  const designation = norm(ex.lot_designation || ex.designation || ex.lot);
  const surface = num(ex.lot_surface || ex.surface);
  if (code) {
    const byCode = propLots.find((l) => norm(l.code) === code);
    if (byCode) return byCode;
  }
  if (designation) {
    const byDesig = propLots.find((l) => {
      const ld = norm(l.designation || '');
      return ld && (ld.includes(designation) || designation.includes(ld));
    });
    if (byDesig) return byDesig;
  }
  if (surface) {
    const bySurf = propLots.find((l) => Number(l.surface) === surface);
    if (bySurf) return bySurf;
  }
  return null;
}

function lotPatchFromBail(ex: any, propertyId?: any): any {
  return {
    ...(propertyId ? { property_id: propertyId } : {}),
    designation: ex.lot_designation || ex.designation || `Lot ${ex.lot_code || ex.code || ''}`.trim() || 'Logement',
    code: ex.lot_code || ex.code || undefined,
    surface: num(ex.lot_surface || ex.surface) || undefined,
    typology: ex.typology || undefined,
    floor: ex.floor || undefined,
    // JAMAIS tenant_name / rent / charges : Lease est la source de vérité locative.
  };
}

function leasePatchFromBail(ex: any, opts: { propertyId?: any; lotId?: any; tenants?: any[]; existing?: any } = {}): any {
  const { propertyId, lotId, tenants, existing } = opts;
  const leaseType = ex.lease_type || inferLeaseType(ex) || existing?.lease_type || 'Vide-Nu';
  const furnished = /meubl/i.test(leaseType) || !!ex.furnished;
  const idxType = ['IRL', 'ILC', 'ILAT'].includes(ex.indexation_type) ? ex.indexation_type : 'aucune';
  const notes = [ex.revision_clause, ex.indexation_clause, ex.notes].filter(Boolean).join('\n') || undefined;
  return {
    ...(propertyId ? { property_id: propertyId } : {}),
    ...(lotId ? { lot_id: lotId } : {}),
    lease_type: leaseType,
    date_start: ex.date_start || ex.date || existing?.date_start,
    date_end: ex.date_end || existing?.date_end || undefined,
    status: 'actif',
    rent_excluding_charges: num(ex.rent_excluding_charges) || 0,
    charges: num(ex.charges) || 0,
    deposit: num(ex.deposit) || 0,
    due_day: num(ex.due_day) || existing?.due_day || 5,
    payment_frequency: ex.payment_frequency || 'mensuel',
    furnished,
    indexation_type: idxType,
    ...(ex.index_reference ? { index_reference: ex.index_reference } : {}),
    ...(ex.index_value_initial != null ? { index_value_initial: num(ex.index_value_initial) } : {}),
    tenants: (tenants && tenants.length) ? tenants : (existing?.tenants || [{ name: 'Locataire' }]),
    ...(notes ? { notes } : {}),
  };
}

/**
 * LeaseDocumentProcessor — plan de commit pour un bail d'habitation.
 *  - multi-locataires : locataire unique, couple, colocation (tenants[]) ;
 *  - matching Property par adresse + Lot au sein du bien (unique / désignation / code / surface) ;
 *  - ambiguïté plusieurs biens à la même adresse → validation requise ;
 *  - bail existant reconnu par locataire → mise à jour (Lease = source de vérité) ;
 *  - JAMAIS d'écriture des données de bail dans les champs legacy du Lot ;
 *  - capture de l'indexation (IRL/ILC/ILAT) + clause de révision.
 */
export function leaseCommitPlan(args: any): any {
  const ex = args.ex || {};
  const conf = args.conf || {};
  const ctx = args.context || {};
  const properties = ctx.properties || [];
  const lots = ctx.lots || [];
  const leases = ctx.leases || [];
  const document_meta = args.document_meta;
  const targets: any[] = [];
  const riskNotes: string[] = [];

  const rawTenants = (Array.isArray(ex.tenants) && ex.tenants.length)
    ? ex.tenants
    : (ex.tenant_name ? [{ name: ex.tenant_name, email: ex.tenant_email || '', phone: ex.tenant_phone || '' }] : []);
  const tenants = rawTenants
    .map((t) => (typeof t === 'string' ? { name: t } : t))
    .filter((t) => t && String(t.name || '').trim())
    .map((t) => ({
      name: String(t.name).trim(),
      email: t.email || '',
      phone: t.phone || '',
      entry_date: t.entry_date || ex.date_start || ex.tenant_entry_date || '',
      ...(t.id ? { id: t.id } : {}),
    }));
  if (!tenants.length) riskNotes.push('Aucun locataire identifié dans le bail — à compléter manuellement.');

  const addr = ex.address || ex.lot_address;
  const na = normAddr(addr);
  let propMatch: any = null;
  let ambiguous = false;
  if (na) {
    let best: any = null, bestScore = 0;
    const matched: any[] = [];
    for (const p of properties) {
      const hay = normAddr([p.address, p.postal_code, p.city, p.name].filter(Boolean).join(' '));
      if (!hay) continue;
      let score = 0;
      if (hay === na) score = 1;
      else if (contains(hay, na) || contains(na, hay)) score = 0.85;
      else if (p.postal_code && na.includes(norm(String(p.postal_code)))) score = 0.6;
      if (score > bestScore) { bestScore = score; best = p; }
      if (score >= 0.85) matched.push(p);
    }
    if (bestScore >= 0.6) {
      propMatch = { property: best, score: bestScore };
      ambiguous = matched.length > 1;
    }
  }

  let propertyId: any = null;
  let lot: any = null;
  if (propMatch && !ambiguous) {
    propertyId = propMatch.property.id;
    lot = matchLotInProperty(propMatch.property, lots) || matchLotByDesignation(propMatch.property, ex, lots);
    if (document_meta) document_meta.property_id = propMatch.property.id;
    if (lot && document_meta) document_meta.lot_id = lot.id;
    const propLots = lots.filter((l) => l.property_id === propMatch.property.id);
    if (!lot && propLots.length > 1) riskNotes.push('Plusieurs lots rattachés à ce bien — précisez le lot concerné.');
  }

  const firstTenantName = tenants[0]?.name || ex.tenant_name;
  let leaseMatch: any = firstTenantName ? matchLeaseByTenant(firstTenantName, leases) : null;
  if (leaseMatch && propMatch && !ambiguous && propMatch.property.id !== leaseMatch.lease.property_id) {
    leaseMatch = null;
  }

  const matchConf = Math.min(
    propMatch ? propMatch.score : 0.3,
    firstTenantName ? fieldConf('tenant_name', conf) : 0.4,
  );

  if (leaseMatch) {
    targets.push({
      entity: 'Lease', action: 'update', id: leaseMatch.lease.id,
      data: leasePatchFromBail(ex, {
        propertyId: propertyId || leaseMatch.lease.property_id,
        lotId: lot?.id || leaseMatch.lease.lot_id,
        tenants, existing: leaseMatch.lease,
      }),
      confidence: Math.max(leaseMatch.score, matchConf),
      needs_review: true,
      reason: `Bail existant pour « ${firstTenantName} » — mise à jour des données du bail`,
    });
    if (document_meta) document_meta.lease_id = leaseMatch.lease.id;
  } else if (ambiguous) {
    riskNotes.push('Plusieurs biens semblent correspondre à cette adresse — précisez le bien cible.');
    targets.push({
      entity: 'Lease', action: 'create',
      data: leasePatchFromBail(ex, { propertyId: null, lotId: null, tenants }),
      confidence: matchConf, needs_review: true,
      reason: 'Plusieurs biens possibles à cette adresse — rattachez le bail au bien concerné',
    });
  } else if (!propMatch) {
    if (!addr) riskNotes.push('Adresse du logement manquante dans le bail — bien créé sans localisation, à compléter.');
    else riskNotes.push("Bien non reconnu : création proposée à partir du bail. Vérifiez qu'il ne s'agit pas d'un bien existant.");
    targets.push({ entity: 'Property', action: 'create', data: propertyPatchFromBail(ex), confidence: 0.7, needs_review: true, reason: 'Adresse non reconnue — création d’un bien à valider', _await_property_id: true });
    targets.push({ entity: 'Lot', action: 'create', data: lotPatchFromBail(ex, null), confidence: 0.7, needs_review: true, reason: 'Lot créé à partir du bail', _await_property_id: true });
    targets.push({ entity: 'Lease', action: 'create', data: leasePatchFromBail(ex, { propertyId: null, lotId: null, tenants }), confidence: matchConf, needs_review: true, reason: 'Nouveau bail créé à partir du document', _await_property_id: true } as any);
  } else {
    if (!lot) {
      targets.push({ entity: 'Lot', action: 'create', data: lotPatchFromBail(ex, propertyId), confidence: 0.7, needs_review: true, reason: 'Lot non identifié sur le bien reconnu — création à valider' });
    }
    const leaseTarget: any = {
      entity: 'Lease', action: 'create',
      data: leasePatchFromBail(ex, { propertyId, lotId: lot?.id || null, tenants }),
      confidence: matchConf, needs_review: true,
      reason: lot ? `Bail rattaché au bien « ${propMatch.property.name} » — lot ${lot.designation || ''}`.trim() : 'Nouveau bail rattaché au bien reconnu',
    };
    targets.push(leaseTarget);
  }

  if (ambiguous) for (const t of targets) t.needs_review = true;

  return { targets, riskNotes };
}

// --- LoanDocumentProcessor --------------------------------------------------
//
// Extrait une offre de prêt / un tableau d'amortissement et propose le
// rattachement au bien (convention loan:<property_id>). Compare les données
// contractuelles (mensualité, nombre d'échéances, intérêts totaux) au calcul
// du moteur loanEngine et signale tout écart significatif (> 1 % sur la
// mensualité, > 1 échéance sur la durée, > 2 % sur les intérêts). Le prêt
// étant un champ sensible (loan_amount), la cible reste `needs_review`.

function pctDelta(contract: number, computed: number): number {
  if (!computed) return 0; // évite la division par zéro
  return ((contract - computed) / computed) * 100;
}

function safeNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v: number): number { return Math.round(v * 100) / 100; }

export function loanCommitPlan(args: any): any {
  const ex = args.ex || {};
  const ctx = args.context || {};
  const properties = ctx.properties || [];
  const document_meta = args.document_meta;
  const classification = ctx.classification || '';
  const targets: any[] = [];
  const riskNotes: string[] = [];

  const addr = ex.address || ex.property_address || ex.bien;
  const m = addr ? matchPropertyByAddress(addr, properties) : null;
  const patch = loanPatch(ex, m?.property);

  const loanInput: any = {
    loan_amount: safeNum(ex.loan_amount),
    loan_rate: safeNum(ex.rate),
    loan_duration_years: safeNum(ex.duration_years),
    loan_start_date: ex.date || ex.loan_start_date || new Date().toISOString().slice(0, 10),
    monthly_payment: safeNum(ex.monthly_payment),
    monthly_insurance: safeNum(ex.insurance),
    loan_deferred_months: safeNum(ex.deferred_months),
  };
  const hasInput = loanInput.loan_amount > 0 && loanInput.loan_duration_years > 0;

  // --- Comparaison moteur vs données contractuelles ---
  const engine: any = {};
  if (hasInput) {
    try {
      const schedule = buildSchedule(loanInput);
      engine.installments_count = schedule.length;
      engine.computed_monthly = computeMonthlyPayment(loanInput);
      const totals = scheduleTotals(schedule);
      engine.total_interest = round2(totals.totalInterest);
      engine.total_paid = round2(totals.totalPaid);

      if (ex.monthly_payment) {
        const deltaPct = Math.abs(pctDelta(safeNum(ex.monthly_payment), engine.computed_monthly));
        if (deltaPct > 1 && Math.abs(safeNum(ex.monthly_payment) - engine.computed_monthly) > 0.5) {
          riskNotes.push(`Mensualité contractuelle (${ex.monthly_payment} €) ≠ calculée par le moteur (${round2(engine.computed_monthly)} €, écart ${deltaPct.toFixed(1)} %). Vérifiez le taux, la durée ou le différé.`);
        }
      }
      if (classification === 'tableau_amortissement') {
        if (ex.installments_count && Math.abs(Number(ex.installments_count) - engine.installments_count) > 1) {
          riskNotes.push(`Nombre d'échéances du tableau (${ex.installments_count}) ≠ moteur (${engine.installments_count}).`);
        }
        if (ex.total_interest && Math.abs(pctDelta(safeNum(ex.total_interest), engine.total_interest)) > 2) {
          riskNotes.push(`Intérêts totaux du tableau (${ex.total_interest} €) ≠ moteur (${engine.total_interest} €).`);
        }
      }
    } catch (e: any) {
      riskNotes.push(`Calcul moteur du prêt impossible : ${e?.message || 'erreur'}.`);
    }
  }

  const loan_meta: any = { engine };
  if (m) {
    loan_meta.property_id = m.property.id;
    targets.push({
      entity: 'Property', action: 'update', id: m.property.id,
      data: patch, confidence: 0.8, needs_review: true,
      reason: `Prêt rattaché au bien « ${m.property.name} »`,
    });
    if (document_meta !== undefined) {
      document_meta.property_id = m.property.id;
      document_meta.loan_meta = loan_meta;
    }
  } else {
    targets.push({
      entity: 'Property', action: 'update',
      data: patch, confidence: 0.4, needs_review: true,
      reason: 'Bien à sélectionner — prêt non rattaché automatiquement',
    } as any);
    riskNotes.push("Prêt sans bien identifié : l'utilisateur doit choisir le bien cible.");
    if (document_meta !== undefined) document_meta.loan_meta = loan_meta;
  }

  return { targets, riskNotes };
}

// --- LegalEntityDocumentProcessor ---------------------------------------------

export function mapLegalType(legalForm: any): any {
  const s = norm(legalForm || '');
  if (!s) return undefined;
  if (s.includes('sci familiale')) return 'SCI familiale';
  if (s.includes('sci')) return 'SCI';
  if (s.includes('sarl de famille')) return 'SARL de famille';
  if (s.includes('sarl')) return 'SARL';
  if (s.includes('sasu')) return 'SASU';
  if (s.includes('sas')) return 'SAS';
  if (s.includes('eurl')) return 'EURL';
  if (s.includes('societe civile')) return 'Société civile';
  if (s.includes('indivision')) return 'Indivision';
  if (s.includes('holding')) return 'Holding';
  return 'Autre société';
}

function isSocietyHolder(h: any): boolean {
  if (!h) return false;
  if (h.siren || h.siret) return true;
  const t = String(h.type || '').toLowerCase();
  return !!t && t !== 'personne physique';
}
function jaccardTokens(a: string, b: string): number {
  const sa = new Set(a.split(' ').filter((t) => t.length > 2));
  const sb = new Set(b.split(' ').filter((t) => t.length > 2));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export function matchLegalEntity(ex: any, holders: any[] = []): any {
  const siren = norm(ex.siren);
  if (siren) {
    const bySiren = holders.find((h) => norm(h.siren) === siren);
    if (bySiren) return { holder: bySiren, score: 1, match: 'siren' };
    return null;
  }
  const siret = norm(ex.siret);
  if (siret) {
    const bySiret = holders.find((h) => norm(h.siret) === siret);
    if (bySiret) return { holder: bySiret, score: 0.95, match: 'siret' };
  }
  const name = norm(ex.company_name || ex.denomination || ex.sci_name || ex.name);
  if (!name) return null;
  const addr = norm(ex.registered_office || ex.address);
  const cap = num(ex.capital);
  if (addr) {
    const byNameAddr = holders.find((h) =>
      norm(h.name) === name && contains(norm(h.address || h.registered_office || ''), addr));
    if (byNameAddr) return { holder: byNameAddr, score: 0.8, match: 'name+address' };
  }
  if (cap != null) {
    const byNameCap = holders.find((h) => norm(h.name) === name && num(h.capital) === cap);
    if (byNameCap) return { holder: byNameCap, score: 0.75, match: 'name+capital' };
  }
  const sameName = holders.filter((h) => norm(h.name) === name);
  if (sameName.length === 1) return { holder: sameName[0], score: 0.6, match: 'name' };
  if (sameName.length > 1) return { holder: null, score: 0.3, match: 'ambiguous_name', candidates: sameName };
  // 4. Correspondance probabiliste (tokens communs) — JAMAIS de fusion auto.
  let bestProb: any = null;
  let bestScore = 0;
  if (name) {
    for (const h of holders) {
      if (!isSocietyHolder(h)) continue;
      const hn = norm(h.name);
      if (!hn || hn === name) continue;
      const j = jaccardTokens(name, hn);
      if (j >= 0.7 && j > bestScore) { bestScore = j; bestProb = h; }
    }
  }
  if (bestProb) return { holder: null, score: bestScore, match: 'similar_name', candidate: bestProb };
  return null;
}

export function matchPersonHolder(associate: any, holders: any[] = []): any {
  const nm = norm(associate.name);
  if (!nm) return null;
  const isMoral = associate.type === 'personne_morale' || associate.type === 'company' || !!associate.siren;
  if (isMoral) {
    const siren = norm(associate.siren);
    if (siren) {
      const m = holders.find((h) => norm(h.siren) === siren);
      if (m) return { holder: m, score: 1, match: 'siren' };
    }
    const m = holders.find((h) => norm(h.name) === nm);
    if (m) return { holder: m, score: 0.7, match: 'name' };
    return null;
  }
  const email = norm(associate.email);
  if (email) {
    const byEmail = holders.find((h) => h.email && norm(h.email) === email);
    if (byEmail && norm(byEmail.name) === nm) return { holder: byEmail, score: 0.95, match: 'name+email' };
  }
  const sameName = holders.filter((h) => norm(h.name) === nm && (!h.type || h.type === 'Personne physique'));
  if (sameName.length === 1) return { holder: sameName[0], score: 0.7, match: 'name', ambiguous: false };
  if (sameName.length > 1) return { holder: null, score: 0.3, match: 'ambiguous_name', candidates: sameName, ambiguous: true };
  return null;
}

export function computePercentFromShares(shareCount: any, totalShares: any): any {
  const sc = num(shareCount);
  const ts = num(totalShares);
  if (sc == null || ts == null || ts === 0) return undefined;
  return Math.round((sc / ts) * 1000) / 10;
}

export function validateCapitalStructure(associates: any[]): any {
  const pcts = associates
    .map((a) => {
      if (a.share_percent != null) return num(a.share_percent);
      return computePercentFromShares(a.share_count || a.shares, a.total_shares);
    })
    .filter((p) => p != null) as number[];
  if (!pcts.length) return { total: null, ok: true, note: null };
  const total = Math.round(pcts.reduce((s, p) => s + p, 0) * 10) / 10;
  if (Math.abs(total - 100) < 0.5) return { total, ok: true, note: null };
  return { total, ok: false, note: `Les pourcentages détectés totalisent ${total} % (≠ 100 %). Vérification nécessaire.` };
}

function legalEntityPatch(ex: any, existing: any): any {
  const type = mapLegalType(ex.legal_form || ex.type) || existing?.type || 'SCI';
  return {
    name: ex.company_name || ex.denomination || ex.sci_name || existing?.name || '',
    type,
    legal_form: ex.legal_form || existing?.legal_form || undefined,
    trade_name: ex.trade_name || undefined,
    siren: ex.siren || existing?.siren || undefined,
    siret: ex.siret || existing?.siret || undefined,
    rcs_number: ex.rcs_number || undefined,
    rcs_city: ex.rcs_city || undefined,
    capital: num(ex.capital != null ? ex.capital : (ex.new_capital != null ? ex.new_capital : ((ex.capital_change && ex.capital_change.new_capital != null) ? ex.capital_change.new_capital : ex.share_capital))) ?? existing?.capital,
    capital_type: ex.capital_type || undefined,
    total_shares: num(ex.total_shares) ?? existing?.total_shares,
    par_value: num(ex.par_value != null ? ex.par_value : ex.nominal_share_value) ?? existing?.par_value,
    creation_date: ex.creation_date || ex.constitution_date || ex.date || existing?.creation_date || undefined,
    registration_date: ex.registration_date || undefined,
    registered_office: ex.registered_office || ex.address || existing?.registered_office || undefined,
    address: ex.registered_office || ex.address || existing?.address || undefined,
    objet_social: ex.objet_social || undefined,
    duration_end: ex.duration_end || undefined,
    fiscal_year_end: ex.fiscal_year_end || undefined,
    representative_name: ex.representative_name || ex.representative || ex.gerant || ex.president || undefined,
    tax_regime: ex.tax_regime || undefined,
    email: ex.email || existing?.email || undefined,
    phone: ex.phone || existing?.phone || undefined,
  };
}

export function legalEntityCommitPlan(args: any): any {
  const ex = args.ex || {};
  const conf = args.conf || {};
  const ctx = args.context || {};
  const classification = ctx.classification || 'statuts_societe';
  const document_meta = args.document_meta;
  const holders = ctx.holders || [];
  const members = ctx.members || [];
  const targets: any[] = [];
  const riskNotes: string[] = [];

  const source_document_id = ex.source_document_id || null;
  const source_page = num(ex.source_page);

  // Références temporelles : chaque Holder créé porte un temp_id unique ; les
  // HolderMember référencent leur parent/member via parent_ref/member_ref. Le
  // commit (commitDocumentImport + commitEngine) résout temp_id -> id réel.
  let _tempSeq = 0;
  const _nextTempId = () => `holder_${++_tempSeq}`;
  const _societyTemp = _nextTempId(); // réservé si la société est créée

  const m = matchLegalEntity(ex, holders);
  let societeId: any = null;
  if (m && m.holder) {
    societeId = m.holder.id;
    targets.push({
      entity: 'Holder', action: 'update', id: m.holder.id,
      data: legalEntityPatch(ex, m.holder),
      confidence: m.score, needs_review: true,
      reason: `Document juridique — mise à jour de la société « ${m.holder.name} » (matching ${m.match})`,
    });
    if (document_meta) { document_meta.holder_id = m.holder.id; document_meta.company_name = m.holder.name; }
    if (num(ex.capital) != null && m.holder.capital != null && num(ex.capital) !== num(m.holder.capital)) {
      riskNotes.push(`Conflit sur le capital : document (${ex.capital} €) vs structure existante (${m.holder.capital} €). À valider.`);
    }
    if (num(ex.total_shares) != null && m.holder.total_shares != null && num(ex.total_shares) !== num(m.holder.total_shares)) {
      riskNotes.push(`Conflit sur le nombre de parts : document (${ex.total_shares}) vs existant (${m.holder.total_shares}). À valider.`);
    }
  } else if (m && m.match === 'ambiguous_name') {
    riskNotes.push(`Plusieurs sociétés portent le nom « ${ex.company_name || ex.denomination} » — précisez laquelle est concernée.`);
    targets.push({ entity: 'Holder', action: 'create', data: legalEntityPatch(ex, null), confidence: 0.5, needs_review: true, reason: 'Homonymie de société — création à valider', temp_id: _societyTemp, _await_holder_id: true } as any);
  } else if (m && m.match === 'similar_name') {
    riskNotes.push(`Société au nom proche déjà existante (« ${m.candidate?.name} ») — pas de fusion automatique : création proposée. Confirmez l'identité.`);
    targets.push({ entity: 'Holder', action: 'create', data: legalEntityPatch(ex, null), confidence: 0.6, needs_review: true, reason: 'Dénomination proche d\'une société existante — création à confirmer (pas de fusion auto)', temp_id: _societyTemp, _await_holder_id: true } as any);
  } else {
    targets.push({ entity: 'Holder', action: 'create', data: legalEntityPatch(ex, null), confidence: 0.7, needs_review: true, reason: 'Création de la structure juridique à valider', temp_id: _societyTemp, _await_holder_id: true } as any);
    if (ex.siren) riskNotes.push(`SIREN ${ex.siren} inconnu — création d'une nouvelle société (pas de fusion par le nom).`);
    else if (ex.company_name || ex.denomination) riskNotes.push("Société non reconnue : création proposée. Vérifiez qu'il ne s'agit pas d'une société existante.");
  }

  if (!ex.tax_regime) {
    riskNotes.push("Régime fiscal non renseigné — à compléter plus tard (ne pas déduire de la forme juridique).");
  } else if (m && m.holder && m.holder.tax_regime && norm(m.holder.tax_regime) !== norm(ex.tax_regime)) {
    riskNotes.push(`Conflit de régime fiscal : document (« ${ex.tax_regime} ») vs existant (« ${m.holder.tax_regime} »). À valider.`);
  }

  let associates: any[] = Array.isArray(ex.associates)
    ? ex.associates
    : (Array.isArray(ex.partners) ? ex.partners : (ex.associate ? [ex.associate] : []));

  // Cession de parts : extraction seller/buyer → synthèse d'associés (sortie du
  // cédant + entrée du cessionnaire). PROPOSITION appliquée par validation.
  if (!associates.length && classification === 'cession_parts' && (ex.seller || ex.buyer)) {
    const ed = ex.effective_date || ex.date;
    if (ex.seller) associates.push({ name: ex.seller, exit_date: ed, share_percent: ex.share_percent });
    if (ex.buyer) associates.push({
      name: ex.buyer, entry_date: ed, share_percent: ex.share_percent,
      total_shares: ex.total_shares, share_count: ex.shares_transferred,
    });
  }
  // Bénéficiaires effectifs : matérialisés comme associés à valider (+ note RBE).
  if (!associates.length && classification === 'beneficiaires_effectifs' && Array.isArray(ex.beneficial_owners)) {
    associates = ex.beneficial_owners.map((b: any) => ({
      name: b.name, type: b.type, siren: b.siren, share_percent: b.share_percent,
      role: 'beneficiaire_effectif',
    }));
    riskNotes.push('Déclaration de bénéficiaires effectifs (RBE) — à valider et enregistrer.');
  }

  if (!associates.length) riskNotes.push('Aucun associé détecté dans le document — à compléter manuellement.');

  const totalSharesDoc = num(ex.total_shares ?? (ex.capital_change && ex.capital_change.total_shares));
  const resolved = associates.map((a) => {
    let pct = a.share_percent != null ? num(a.share_percent) : null;
    if (pct == null) pct = computePercentFromShares(a.share_count || a.shares, a.total_shares != null ? a.total_shares : totalSharesDoc);
    return { a, pct };
  });

  const cap = validateCapitalStructure(resolved.map((r) => ({ share_percent: r.pct, share_count: r.a.share_count, total_shares: r.a.total_shares })));
  if (cap.note) riskNotes.push(cap.note);

  let hasDemembrement = false;
  let hasCycle = false;

  for (const { a, pct } of resolved) {
    if (!a || !a.name) continue;
    const isMoral = a.type === 'personne_morale' || a.type === 'company' || !!a.siren;
    const pm = matchPersonHolder(a, holders);
    let memberId: any = null;
    if (pm && pm.holder) {
      memberId = pm.holder.id;
      if (isMoral && a.siren && !pm.holder.siren) {
        targets.push({ entity: 'Holder', action: 'update', id: pm.holder.id, data: { siren: a.siren }, confidence: 0.9, needs_review: true, reason: `Associé personne morale — complément SIREN` });
      }
    } else if (pm && pm.ambiguous) {
      riskNotes.push(`Personne physique « ${a.name} » ambiguë : plusieurs détenteurs existants portent ce nom. À confirmer (pas de fusion automatique).`);
    }

    if (memberId && societeId && memberId === societeId) {
      hasCycle = true;
      riskNotes.push(`Boucle de détention détectée : « ${a.name} » est à la fois la société et son propre associé. Validation requise.`);
    }

    if (a.demembrement && a.demembrement !== 'pleine_propriete') hasDemembrement = true;

    const changeReason = classification === 'cession_parts'
      ? 'cession'
      : classification === 'augmentation_capital'
        ? 'augmentation_capital'
        : classification === 'reduction_capital'
          ? 'reduction_capital'
          : undefined;

    if (a.exit_date && members.length) {
      const existingMemberRel = members.find((mm) => mm.parent_holder_id === societeId && mm.member_holder_id === memberId && !mm.exit_date);
      if (existingMemberRel) {
        targets.push({
          entity: 'HolderMember', action: 'update', id: existingMemberRel.id,
          data: { exit_date: a.exit_date, change_reason: changeReason || 'cession', ...(source_document_id ? { source_document_id } : {}) },
          confidence: 0.8, needs_review: true,
          reason: `Sortie de l'associé « ${a.name} » (cession) — historique conservé`,
        });
        continue;
      }
    }

    // temp_id du déteneur si l'associé est créé dans la passe (sinon null = existant).
    const memberTemp = memberId ? null : _nextTempId();

    targets.push({
      entity: 'HolderMember', action: 'create',
      parent_ref: !societeId ? _societyTemp : undefined,
      member_ref: memberTemp || undefined,
      data: {
        ...(societeId ? { parent_holder_id: societeId } : {}),
        ...(memberId ? { member_holder_id: memberId } : { _await_member_name: a.name }),
        share_percent: pct != null ? pct : undefined,
        total_shares: num(a.share_count || a.shares) || undefined,
        quality: a.quality || 'associe',
        demembrement: a.demembrement || 'pleine_propriete',
        entry_date: a.entry_date || ex.document_date || ex.date || undefined,
        exit_date: a.exit_date || undefined,
        ...(source_document_id ? { source_document_id } : {}),
        ...(source_page != null ? { source_page } : {}),
        ...(changeReason ? { change_reason: changeReason } : {}),
      },
      confidence: (pm && pm.holder) ? Math.max(pm.score, 0.7) : 0.6,
      needs_review: true,
      reason: `Associé « ${a.name} » — ${pct != null ? pct + ' %' : 'part à préciser'}${isMoral ? ' (personne morale)' : ''}`,
      _await_holder_id: !societeId,
    } as any);

    if ((!pm || !pm.holder) && !(pm && pm.ambiguous)) {
      targets.push({
        entity: 'Holder', action: 'create',
        data: { name: a.name, type: isMoral ? mapLegalType(a.legal_form) || 'Société civile' : 'Personne physique', ...(a.siren ? { siren: a.siren } : {}), ...(a.email ? { email: a.email } : {}) },
        temp_id: memberTemp || undefined,
        confidence: 0.6, needs_review: true,
        reason: `Nouveau détenteur « ${a.name} » — création à valider`,
        _await_member_name: a.name,
      } as any);
    }
  }

  if (hasDemembrement) riskNotes.push('Structure de détention complexe à vérifier (démembrement détecté).');
  return { targets, riskNotes };
}

function loanPatch(ex: any, prop: any): any {
  return {
    bank: ex.bank || prop?.bank || '',
    loan_amount: num(ex.loan_amount) || prop?.loan_amount,
    loan_rate: num(ex.rate) || prop?.loan_rate,
    loan_duration_years: num(ex.duration_years) || prop?.loan_duration_years,
    monthly_payment: num(ex.monthly_payment) || prop?.monthly_payment,
    monthly_insurance: num(ex.insurance) || num(ex.monthly_insurance) || prop?.monthly_insurance,
    loan_start_date: ex.date || ex.loan_start_date || prop?.loan_start_date,
  };
}
function lotPatch(ex: any, propertyId?: any): any {
  return {
    ...(propertyId ? { property_id: propertyId } : {}),
    designation: ex.designation || `Lot ${ex.typology || ''}`.trim() || 'Logement',
    surface: num(ex.surface) || undefined,
    typology: ex.typology || undefined,
    floor: ex.floor || undefined,
    code: ex.code || undefined,
  };
}
function dpePatch(ex: any, lot: any): any {
  const patch: any = {
    dpe_class: ex.energy_class || ex.dpe_class || undefined,
    ges_class: ex.ges_class || undefined,
    energy_consumption: num(ex.energy_consumption) || undefined,
    dpe_date: ex.date || ex.dpe_date || undefined,
  };
  if (num(ex.surface) && !lot?.surface) patch.surface = num(ex.surface);
  return patch;
}
function holderPatch(ex: any): any {
  return {
    name: ex.company_name || ex.sci_name || '', type: 'SCI',
    siret: ex.siret || ex.sci_siret || '', capital: num(ex.capital) || num(ex.sci_capital) || undefined,
    address: ex.address || '', creation_date: ex.date || ex.sci_creation_date || undefined, bank: ex.sci_bank || ex.bank || '',
  };
}
function num(v: any): any {
  if (v == null || v === '') return undefined;
  const n = Number(String(v).replace(/[^0-9.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}
export function splitAddress(addr: any): any {
  if (!addr) return { street: '', postal_code: '', city: '' };
  const m = String(addr).match(/^(.*?)[,\s]+(\d{5})\s+(.+)$/);
  if (m) return { street: m[1].trim(), postal_code: m[2], city: m[3].trim() };
  return { street: addr, postal_code: '', city: '' };
}