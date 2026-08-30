export const ALERT_SOURCES = [
  'loyer_impaye',
  'paiement_non_rapproche',
  'bail_expirant',
  'indexation_disponible',
  'dpe',
  'assurance',
  'echeance_fiscale',
  'ag_copropriete',
  'echeance_credit',
  'document_manquant',
  'anomalie_financiere',
  'echeance_loyer',
  'echeance_sci',
] as const;

export type AlertSource = (typeof ALERT_SOURCES)[number];
export type Priority = 'information' | 'a_traiter' | 'important' | 'urgent';
export type AlertStatus = 'active' | 'resolved' | 'ignored' | 'snoozed';
export type LinkedType =
  | 'property' | 'lot' | 'lease' | 'impaye' | 'payment'
  | 'bank_transaction' | 'document' | 'rent_revision' | 'transaction' | 'holder' | 'none';

export interface AlertDraft {
  source: AlertSource;
  linked_type: LinkedType;
  linked_id: string;
  linked_label: string;
  date: string; // YYYY-MM-DD
  priority: Priority;
  title: string;
  message: string;
  recommended_action: string;
  action_url: string;
  fingerprint: string;
}

interface AlertData {
  properties: any[];
  lots: any[];
  leases: any[];
  impayes: any[];
  payments: any[];
  bankTransactions: any[];
  documents: any[];
  rentRevisions: any[];
  rentDues: any[];
  transactions: any[];
  holders: any[];
}

export const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 4,
  important: 3,
  a_traiter: 2,
  information: 1,
};

export function stableFingerprint(source: AlertSource, linked_type: LinkedType, linked_id: string, detail = '') {
  return [source, `${linked_type}:${linked_id || '-'}`, detail || '-'].join('||');
}

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function iso(d: Date) { return d.toISOString().slice(0, 10); }
function parse(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function leaseActive(l: any, now: Date) {
  if (l.status === 'resilie' || l.status === 'termine') return false;
  const end = parse(l.date_end);
  if (end && end < now) return false;
  return true;
}

const FISCAL_DEADLINES: { key: string; label: string; month: number; day: number; url: string }[] = [
  { key: 'tf', label: 'Taxe foncière', month: 10, day: 15, url: '/impots' },
  { key: 'cfe', label: 'CFE (cotisation foncière entreprises)', month: 12, day: 15, url: '/impots' },
  { key: 'irl_decl', label: 'Déclaration revenus fonciers (2044)', month: 5, day: 20, url: '/impots' },
  { key: 'acompte1', label: 'Acompte impôt revenus (1er)', month: 5, day: 15, url: '/impots' },
  { key: 'acompte2', label: 'Acompte impôt revenus (2e)', month: 9, day: 15, url: '/impots' },
];

function nextFiscal(now: Date, horizonDays = 60) {
  const out: { key: string; label: string; date: Date; days: number; url: string }[] = [];
  const year = now.getFullYear();
  for (const d of FISCAL_DEADLINES) {
    let dt = new Date(year, d.month - 1, d.day);
    if (dt < now) dt = new Date(year + 1, d.month - 1, d.day);
    const day = daysBetween(now, dt);
    if (day <= horizonDays) out.push({ key: d.key, label: d.label, date: dt, days: day, url: d.url });
  }
  return out.sort((a, b) => a.days - b.days);
}

export function generateAlerts(data: AlertData, now: Date = new Date()): AlertDraft[] {
  const out: AlertDraft[] = [];
  const today = now;
  const todayISOStr = iso(today);
  const properties = data.properties || [];
  const lots = data.lots || [];
  const leases = data.leases || [];
  const impayes = data.impayes || [];
  const payments = data.payments || [];
  const bankTx = data.bankTransactions || [];
  const documents = data.documents || [];
  const revisions = data.rentRevisions || [];
  const rentDues = data.rentDues || [];
  const transactions = data.transactions || [];
  const holders = data.holders || [];

  const propName = (id?: string | null) => properties.find((p) => p.id === id)?.name || '';
  const leaseLabel = (l: any) => `${l.tenants?.[0]?.name || 'Bail'} · ${l.date_start || ''}`;
  const lotLabel = (l: any) => `${l.designation || 'Lot'}${l.property_id ? ' (' + propName(l.property_id) + ')' : ''}`;

  // 1. Loyers impayés
  for (const i of impayes) {
    if (i.status === 'régularisé' || i.status === 'regularise' || i.status === 'abandonné' || i.status === 'abandonne') continue;
    const late = Number(i.late_days) || 0;
    const priority: Priority = late > 45 ? 'urgent' : late > 20 ? 'important' : 'a_traiter';
    out.push({
      source: 'loyer_impaye',
      linked_type: 'impaye',
      linked_id: i.id,
      linked_label: `${i.tenant_name || ''} · ${i.period || ''}${i.property_name ? ' — ' + i.property_name : ''}`,
      date: i.first_unpaid_date || i.due_date || i.detected_date || todayISOStr,
      priority,
      title: `Loyer impayé — ${i.tenant_name || 'locataire'} (${i.period || ''})`,
      message: `Reste dû ${i.missing_amount ?? i.outstanding_amount ?? 0}€ · retard ${late} j · étape « ${i.status || ''} ».`,
      recommended_action: "Relancer le locataire ou faire avancer le dossier de recouvrement.",
      action_url: '/impayes',
      fingerprint: stableFingerprint('loyer_impaye', 'impaye', i.id),
    });
  }

  // 2. Paiements non rapprochés (BankTransaction pending entrante)
  for (const b of bankTx) {
    if (b.status !== 'pending') continue;
    if (Number(b.amount) <= 0) continue;
    out.push({
      source: 'paiement_non_rapproche',
      linked_type: 'bank_transaction',
      linked_id: b.id,
      linked_label: `${b.raw_description || b.normalized_description || 'Opération'} · ${b.amount}€`,
      date: b.date || todayISOStr,
      priority: 'a_traiter',
      title: 'Paiement reçu non rapproché',
      message: `Un encaissement de ${b.amount}€ (${b.date || ''}) n'est pas encore affecté à un bien / échéance.`,
      recommended_action: "Catégoriser et rattacher la transaction à un bien et une échéance.",
      action_url: '/import',
      fingerprint: stableFingerprint('paiement_non_rapproche', 'bank_transaction', b.id),
    });
  }
  for (const p of payments) {
    if (!p.unallocated || Number(p.unallocated) <= 0) continue;
    out.push({
      source: 'paiement_non_rapproche',
      linked_type: 'payment',
      linked_id: p.id,
      linked_label: `${p.payer_name || 'Payeur'} · ${p.amount}€ (${p.date || ''})`,
      date: p.date || todayISOStr,
      priority: 'a_traiter',
      title: 'Avoir / paiement à affecter',
      message: `Reste non affecté : ${p.unallocated}€ sur le paiement de ${p.amount}€ (${p.date || ''}).`,
      recommended_action: "Affecter le solde à une échéance à venir ou en faire un avoir.",
      action_url: '/compte-locataire',
      fingerprint: stableFingerprint('paiement_non_rapproche', 'payment', p.id, 'unallocated'),
    });
  }

  // 3. Bails expirants
  for (const l of leases) {
    if (!leaseActive(l, today)) continue;
    const end = parse(l.date_end);
    if (!end) continue;
    const d = daysBetween(today, end);
    if (d < 0 || d > 90) continue;
    const priority: Priority = d <= 15 ? 'urgent' : d <= 30 ? 'important' : 'a_traiter';
    out.push({
      source: 'bail_expirant',
      linked_type: 'lease',
      linked_id: l.id,
      linked_label: `${leaseLabel(l)} · ${propName(l.property_id)}`,
      date: iso(end),
      priority,
      title: `Bail arrivant à échéance dans ${d} j`,
      message: `Échéance du bail le ${iso(end)}. Préparer le renouvellement, la sortie ou l'état des lieux.`,
      recommended_action: "Préparer l'avenant, l'état des lieux de sortie ou le relogement.",
      action_url: l.property_id ? `/biens/${l.property_id}` : '/locataires',
      fingerprint: stableFingerprint('bail_expirant', 'lease', l.id, iso(end)),
    });
  }

  // 4. Indexation disponible (propositions en attente)
  for (const r of revisions) {
    if (r.status !== 'proposition') continue;
    const lease = leases.find((l) => l.id === r.lease_id);
    out.push({
      source: 'indexation_disponible',
      linked_type: 'rent_revision',
      linked_id: r.id,
      linked_label: `${r.lot_designation || lease?.lot_id || ''} — ${r.old_rent || 0}€ → ${r.new_rent || 0}€`,
      date: r.new_revision_date || r.created_date || todayISOStr,
      priority: 'a_traiter',
      title: `Révision de loyer à valider (${r.variation_percent ?? 0}%)`,
      message: `Nouveau loyer théorique : ${r.new_rent}€ (+${r.variation_amount ?? 0}€). À valider avant application au bail.`,
      recommended_action: "Valider puis appliquer la révision au bail.",
      action_url: '/loyers-revision',
      fingerprint: stableFingerprint('indexation_disponible', 'rent_revision', r.id),
    });
  }
  // 4b. Bail indexable non révisé depuis > 1 an (sans proposition)
  const revisionByLease = new Set(revisions.map((r) => r.lease_id));
  for (const l of leases) {
    if (!leaseActive(l, today)) continue;
    if (l.indexation_type === 'aucune' || !l.indexation_type) continue;
    if (revisionByLease.has(l.id)) continue;
    const last = parse(l.last_revision_date) || parse(l.date_start);
    if (!last) continue;
    const d = daysBetween(last, today);
    if (d < 365) continue;
    out.push({
      source: 'indexation_disponible',
      linked_type: 'lease',
      linked_id: l.id,
      linked_label: `${leaseLabel(l)} · ${propName(l.property_id)}`,
      date: todayISOStr,
      priority: 'information',
      title: 'Révision de loyer possible',
      message: `Bail indexable (${l.indexation_type}) non révisé depuis ${Math.round(d / 30)} mois.`,
      recommended_action: "Lancer une proposition de révision sur l'indice.",
      action_url: '/loyers-revision',
      fingerprint: stableFingerprint('indexation_disponible', 'lease', l.id, 'due'),
    });
  }

  // 5. DPE — lots passoires thermiques
  for (const lot of lots) {
    if (lot.dpe_class === 'F' || lot.dpe_class === 'G') {
      out.push({
        source: 'dpe',
        linked_type: 'lot',
        linked_id: lot.id,
        linked_label: lotLabel(lot),
        date: lot.dpe_date || todayISOStr,
        priority: 'important',
        title: `DPE classe ${lot.dpe_class} — logement indécent`,
        message: `Lot ${lot.designation || ''} classé ${lot.dpe_class}. Travaux / interdiction de louer à échoir selon le calendrier Climat.`,
        recommended_action: "Planifier les travaux ou vérifier l'éligibilité à la location.",
        action_url: lot.property_id ? `/biens/${lot.property_id}` : '/biens',
        fingerprint: stableFingerprint('dpe', 'lot', lot.id, lot.dpe_class),
      });
    }
  }
  // 5b. Documents expirants (DPE / assurance / AG)
  for (const d of documents) {
    const exp = parse(d.expiration_date);
    if (!exp) continue;
    if (d.type !== 'dpe' && d.type !== 'assurance' && d.type !== 'ag_copropriete') continue;
    const dday = daysBetween(today, exp);
    if (d.type !== 'assurance' && dday < 0) continue;
    if (dday > 60) continue;
    const expired = dday < 0;
    const priority: Priority = d.type === 'assurance'
      ? (expired ? 'urgent' : dday <= 15 ? 'important' : 'a_traiter')
      : (expired ? 'important' : 'a_traiter');
    const src: AlertSource = d.type === 'assurance' ? 'assurance' : d.type === 'ag_copropriete' ? 'ag_copropriete' : 'dpe';
    const kindLabel = d.type === 'assurance' ? 'Assurance' : d.type === 'ag_copropriete' ? 'AG copropriété' : 'DPE';
    out.push({
      source: src,
      linked_type: 'document',
      linked_id: d.id,
      linked_label: `${d.title || d.filename || ''}${d.lot_id ? ' (lot ' + (lots.find((l) => l.id === d.lot_id)?.designation || d.lot_id) + ')' : ''}`,
      date: iso(exp),
      priority,
      title: `${kindLabel} ${expired ? 'expiré(e)' : 'à renouveler'}`,
      message: `${d.title || d.filename || ''} — échéance ${iso(exp)} (${expired ? 'dépassée' : 'dans ' + dday + ' j'}).`,
      recommended_action: d.type === 'assurance'
        ? "Renouveler le contrat d'assurance PNO / GLC."
        : d.type === 'ag_copropriete'
        ? "Consulter et préparer le vote en AG."
        : "Faire réaliser un nouveau DPE.",
      action_url: '/documents',
      fingerprint: stableFingerprint(src, 'document', d.id, iso(exp)),
    });
  }

  // 6. AG copropriété à venir
  for (const d of documents) {
    if (d.type !== 'ag_copropriete') continue;
    const dd = parse(d.document_date);
    if (!dd) continue;
    const dday = daysBetween(today, dd);
    if (dday < 0 || dday > 30) continue;
    out.push({
      source: 'ag_copropriete',
      linked_type: 'document',
      linked_id: d.id,
      linked_label: d.title || d.filename || '',
      date: iso(dd),
      priority: 'a_traiter',
      title: `AG de copropriété le ${iso(dd)}`,
      message: `Convocation ${d.title || ''} — préparer les votes (charges, travaux, comptes).`,
      recommended_action: "Consulter la convocation et préparer les pouvoirs / votes.",
      action_url: '/documents',
      fingerprint: stableFingerprint('ag_copropriete', 'document', d.id, 'upcoming-' + iso(dd)),
    });
  }

  // 7. Échéances fiscales
  for (const f of nextFiscal(today, 60)) {
    const priority: Priority = f.days <= 7 ? 'urgent' : f.days <= 15 ? 'important' : 'a_traiter';
    out.push({
      source: 'echeance_fiscale',
      linked_type: 'none',
      linked_id: f.key,
      linked_label: f.label,
      date: iso(f.date),
      priority,
      title: `Échéance fiscale : ${f.label} (${iso(f.date)})`,
      message: `${f.label} — ${f.days === 0 ? "aujourd'hui" : 'dans ' + f.days + ' j'} (${iso(f.date)}).`,
      recommended_action: "Vérifier le règlement / la déclaration et préparer les justificatifs.",
      action_url: f.url,
      fingerprint: stableFingerprint('echeance_fiscale', 'none', f.key, iso(f.date)),
    });
  }

  // 8. Échéance crédit
  const loanInstallKeys = new Set(transactions.filter((t) => t.category === 'loan_installment').map((t) => `${t.property_id}|${t.year}|${t.month}`));
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lmKey = (pid: string) => `${pid}|${lastMonth.getFullYear()}|${lastMonth.getMonth() + 1}`;
  for (const p of properties) {
    if (!p.loan_amount || Number(p.loan_amount) <= 0) continue;
    if (p.loan_start_date && p.loan_duration_years) {
      const end = new Date(new Date(p.loan_start_date).getTime() + p.loan_duration_years * 365.25 * 86400000);
      const d = daysBetween(today, end);
      if (d >= 0 && d <= 180) {
        out.push({
          source: 'echeance_credit',
          linked_type: 'property',
          linked_id: p.id,
          linked_label: p.name,
          date: iso(end),
          priority: d <= 30 ? 'important' : 'a_traiter',
          title: `Fin de prêt ${p.name} dans ${d} j`,
          message: `Échéance finale du crédit estimée le ${iso(end)} (début ${p.loan_start_date}, ${p.loan_duration_years} ans). Préparer la mainlevée.`,
          recommended_action: "Anticiper la mainlevée et le nouveau montage financier.",
          action_url: `/biens/${p.id}`,
          fingerprint: stableFingerprint('echeance_credit', 'property', p.id, 'maturity'),
        });
      }
    }
    if (p.monthly_payment && !loanInstallKeys.has(lmKey(p.id))) {
      const lmStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
      out.push({
        source: 'echeance_credit',
        linked_type: 'property',
        linked_id: p.id,
        linked_label: p.name,
        date: iso(lastMonth),
        priority: 'important',
        title: `Mensualité de crédit non comptabilisée — ${p.name}`,
        message: `Aucune échéance « loan_installment » trouvée pour ${lmStr}. Mensualité attendue ${p.monthly_payment}€.`,
        recommended_action: "Vérifier le prélèvement et importer / saisir l'échéance.",
        action_url: '/import',
        fingerprint: stableFingerprint('echeance_credit', 'property', p.id, lmStr),
      });
    }
  }

  // 9. Documents manquants pour les bails actifs
  for (const l of leases) {
    if (!leaseActive(l, today)) continue;
    const lot = lots.find((x) => x.id === l.lot_id);
    const lid = l.id;
    const hasBail = documents.some((d) => d.lease_id === lid && d.type === 'bail');
    const hasDPE = (lot && documents.some((d) => d.lot_id === lot.id && d.type === 'dpe')) || (lot && lot.dpe_class);
    const hasEDL = documents.some((d) => d.lease_id === lid && d.type === 'etat_des_lieux');
    if (!hasBail) {
      out.push({
        source: 'document_manquant',
        linked_type: 'lease',
        linked_id: l.id,
        linked_label: `${leaseLabel(l)} · ${propName(l.property_id)}`,
        date: l.date_start || todayISOStr,
        priority: 'important',
        title: 'Contrat de bail manquant',
        message: `Aucun document de type « bail » rattaché au bail actif ${leaseLabel(l)}.`,
        recommended_action: "Importer le contrat de bail signé.",
        action_url: '/documents',
        fingerprint: stableFingerprint('document_manquant', 'lease', l.id, 'bail'),
      });
    }
    if (!hasDPE && lot) {
      out.push({
        source: 'document_manquant',
        linked_type: 'lot',
        linked_id: lot.id,
        linked_label: lotLabel(lot),
        date: todayISOStr,
        priority: 'important',
        title: 'DPE manquant',
        message: `Aucun DPE rattaché au lot ${lot.designation || ''}. Obligatoire pour la location.`,
        recommended_action: "Faire réaliser un DPE et l'importer.",
        action_url: '/documents',
        fingerprint: stableFingerprint('document_manquant', 'lot', lot.id, 'dpe'),
      });
    }
    if (!hasEDL) {
      out.push({
        source: 'document_manquant',
        linked_type: 'lease',
        linked_id: l.id,
        linked_label: `${leaseLabel(l)} · ${propName(l.property_id)}`,
        date: l.date_start || todayISOStr,
        priority: 'information',
        title: 'État des lieux manquant',
        message: `Aucun état des lieux rattaché au bail ${leaseLabel(l)}.`,
        recommended_action: "Importer l'état des lieux d'entrée.",
        action_url: '/documents',
        fingerprint: stableFingerprint('document_manquant', 'lease', l.id, 'edl'),
      });
    }
  }

  // 10. Anomalies financières
  const currentPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const impByRentDue = new Set(impayes.map((i) => i.rent_due_id));
  for (const rd of rentDues) {
    if (rd.status !== 'unpaid') continue;
    if (impByRentDue.has(rd.id)) continue;
    if (rd.period === currentPeriod) continue;
    out.push({
      source: 'anomalie_financiere',
      linked_type: 'transaction',
      linked_id: rd.id,
      linked_label: `${rd.tenant_name || ''} · ${rd.period || ''}`,
      date: rd.due_date || todayISOStr,
      priority: 'important',
      title: 'Échéance impayée non suivie en recouvrement',
      message: `L'échéance ${rd.period} de ${rd.tenant_name || ''} est impayée (${rd.total_due - (rd.paid_amount || 0)}€) sans dossier de recouvrement ouvert.`,
      recommended_action: "Lancer la détection des impayés ou relancer manuellement.",
      action_url: '/impayes',
      fingerprint: stableFingerprint('anomalie_financiere', 'transaction', rd.id, 'unpaid-no-impaye'),
    });
  }
  const quittanceKeys = new Set(documents.filter((d) => d.type === 'quittance').map((d) => `${d.lease_id}|${d.year}-${String(d.month).padStart(2, '0')}`));
  for (const l of leases) {
    if (!leaseActive(l, today)) continue;
    const lmStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
    const key = `${l.id}|${lmStr}`;
    if (!quittanceKeys.has(key)) {
      out.push({
        source: 'anomalie_financiere',
        linked_type: 'lease',
        linked_id: l.id,
        linked_label: `${leaseLabel(l)} · ${propName(l.property_id)}`,
        date: iso(lastMonth),
        priority: 'information',
        title: 'Quittance non émise sur le mois dernier',
        message: `Aucune quittance émise pour ${leaseLabel(l)} sur ${lmStr}.`,
        recommended_action: "Générer la quittance du mois dernier.",
        action_url: '/quittances',
        fingerprint: stableFingerprint('anomalie_financiere', 'lease', l.id, 'no-quittance-' + key),
      });
    }
  }

  // 11. Échéances de loyer à venir (proactif — avant l'échéance, pour ne rater
  // aucun encaissement). On exclut les échéances déjà suivies en impayé.
  const impayeByRentDue = new Set(impayes.map((i: any) => i.rent_due_id).filter(Boolean));
  for (const rd of rentDues) {
    if (rd.status === 'paid') continue;
    const balance = Number(rd.balance ?? ((rd.total_due || 0) - (rd.paid_amount || 0)));
    if (balance <= 0) continue;
    const due = parse(rd.due_date);
    if (!due) continue;
    const d = daysBetween(today, due);
    if (d < 0 || d > 7) continue;
    if (impayeByRentDue.has(rd.id)) continue;
    const priority: Priority = d <= 2 ? 'urgent' : d <= 4 ? 'important' : 'a_traiter';
    out.push({
      source: 'echeance_loyer',
      linked_type: 'transaction',
      linked_id: rd.id,
      linked_label: `${rd.tenant_name || ''} · ${rd.period || ''}${propName(rd.property_id) ? ' · ' + propName(rd.property_id) : ''}`,
      date: iso(due),
      priority,
      title: `Loyer à encaisser — ${rd.tenant_name || 'locataire'} (${rd.period || ''}) dans ${d} j`,
      message: `Échéance ${rd.period || ''} de ${rd.tenant_name || 'locataire'} : ${rd.total_due ?? 0}€ à encaisser le ${iso(due)}${d === 0 ? " (aujourd'hui)" : ''}.`,
      recommended_action: "Vérifier le règlement du locataire puis rapprocher l'encaissement.",
      action_url: '/loyers',
      fingerprint: stableFingerprint('echeance_loyer', 'transaction', rd.id, rd.period || iso(due)),
    });
  }

  // 12. Dates clés des SCI / structures : clôture d'exercice (fiscal_year_end),
  // AG annuelle d'approbation des comptes (exercice + 6 mois), fin de durée
  // sociale (duration_end). Uniquement pour les sociétés (pas personne physique).
  for (const h of holders) {
    const ht = String(h?.type || '').toLowerCase();
    if (!ht || ht === 'personne physique' || ht === 'indivision') continue;
    const label = h.trade_name || h.name || 'Société';
    const fye = String(h.fiscal_year_end || '').trim();
    if (/^\d{2}-\d{2}$/.test(fye)) {
      const [mm, dd] = fye.split('-').map(Number);
      const year = today.getFullYear();
      let close = new Date(year, mm - 1, dd);
      if (iso(close) < todayISOStr) close = new Date(year + 1, mm - 1, dd);
      const dc = daysBetween(today, close);
      if (dc >= 0 && dc <= 30) {
        const priority: Priority = dc <= 7 ? 'urgent' : dc <= 15 ? 'important' : 'a_traiter';
        out.push({
          source: 'echeance_sci',
          linked_type: 'holder', linked_id: h.id, linked_label: label,
          date: iso(close), priority,
          title: `Clôture d'exercice — ${label} (${iso(close)})`,
          message: `Exercice social de ${label} clôturant le ${iso(close)} (${dc === 0 ? "aujourd'hui" : 'dans ' + dc + ' j'}). Préparer la liasse fiscale et l'AG d'approbation.`,
          recommended_action: "Préparer les comptes annuels et convoquer l'AG d'approbation.",
          action_url: '/reglages?section=equipe',
          fingerprint: stableFingerprint('echeance_sci', 'holder', h.id, 'fye-' + iso(close)),
        });
      }
      // AG annuelle d'approbation des comptes (6 mois après la clôture).
      let ag = new Date(close.getFullYear(), close.getMonth() + 6, close.getDate());
      if (iso(ag) < todayISOStr) ag = new Date(ag.getFullYear() + 1, ag.getMonth(), ag.getDate());
      const dag = daysBetween(today, ag);
      if (dag >= 0 && dag <= 30) {
        const priority: Priority = dag <= 7 ? 'urgent' : dag <= 15 ? 'important' : 'a_traiter';
        out.push({
          source: 'echeance_sci',
          linked_type: 'holder', linked_id: h.id, linked_label: label,
          date: iso(ag), priority,
          title: `AG annuelle d'approbation — ${label} (${iso(ag)})`,
          message: `Assemblée générale d'approbation des comptes de ${label} à tenir avant le ${iso(ag)} (${dag === 0 ? "aujourd'hui" : 'dans ' + dag + ' j'}).`,
          recommended_action: "Convoquer l'AG, préparer le PV et déposer les comptes annuels.",
          action_url: '/reglages?section=equipe',
          fingerprint: stableFingerprint('echeance_sci', 'holder', h.id, 'ag-' + iso(ag)),
        });
      }
    }
    const durEnd = parse(h.duration_end);
    if (durEnd) {
      const d = daysBetween(today, durEnd);
      if (d >= 0 && d <= 90) {
        const priority: Priority = d <= 30 ? 'important' : 'a_traiter';
        out.push({
          source: 'echeance_sci',
          linked_type: 'holder', linked_id: h.id, linked_label: label,
          date: iso(durEnd), priority,
          title: `Fin de durée sociale — ${label} (${iso(durEnd)})`,
          message: `La société ${label} arrive à fin de durée le ${iso(durEnd)} (${d === 0 ? "aujourd'hui" : 'dans ' + d + ' j'}). Préparer la prorogation ou la dissolution.`,
          recommended_action: "Décider prorogation / dissolution et convoquer une AG extraordinaire.",
          action_url: '/reglages?section=equipe',
          fingerprint: stableFingerprint('echeance_sci', 'holder', h.id, 'dur-' + iso(durEnd)),
        });
      }
    }
  }

  return out;
}