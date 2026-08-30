/**
 * Génération PDF des quittances de loyer (jsPDF, A4 portrait, sobre/bleu).
 *
 * Source de données = le compte locataire réel (RentDue -> Payments), via
 * l'enregistrement Quittance immuable (snapshots). Ce module ne fait que du
 * rendu à partir d'un "row" — aucune logique métier (l'éligibilité et les
 * snapshots sont décidés côté serveur par generateQuittance).
 *
 * Deux types de document :
 *  - kind="full"    -> QUITTANCE DE LOYER (loyer / charges / provisions /
 *    total dû / total payé = total dû, soldé)
 *  - kind="partial" -> REÇU POUR PAIEMENT PARTIEL (idem + reste à payer)
 *
 * La date de paiement provient des paiements réels (row.paymentDate), jamais
 * hardcodée au 1er du mois. La mention légale est centralisée côté serveur et
 * figée dans row.legalNote.
 */

import { jsPDF } from 'jspdf';
import { getMonthName } from '@/lib/formatters';

export function periodLabel(year, month) {
  return `${getMonthName(month)} ${year}`;
}

const fmtMoney = (n) => {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' €';
};

/** Construit un "row" PDF à partir d'un enregistrement Quittance immuable. */
export function quittanceToPdfRow(q) {
  return {
    kind: q.kind || 'full',
    receipt_number: q.receipt_number,
    periodLabel: `${getMonthName(q.month)} ${q.year}`,
    landlordName: q.landlord_name,
    landlordAddress: q.landlord_address,
    tenantName: q.tenant_name,
    tenantAddress: q.tenant_address,
    propertyName: q.property_name,
    lotDesignation: q.lot_designation,
    lotAddress: q.lot_address,
    rentHc: Number(q.rent_hc) || 0,
    charges: Number(q.charges) || 0,
    additionalAmount: Number(q.additional_amount) || 0,
    totalDue: Number(q.total_due) || 0,
    paidAmount: Number(q.paid_amount) || 0,
    balance: Number(q.balance) ?? (Number(q.total_due) || 0) - (Number(q.paid_amount) || 0),
    paymentMethod: q.payment_method || '',
    paymentDate: q.payment_date || '',
    issueDate: q.issue_date || '',
    legalNote: q.legal_note || '',
  };
}

export function buildSingleQuittance(row) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  drawReceipt(doc, row);
  return doc;
}

export function buildQuittanceDocument(rows) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  rows.forEach((r, i) => { if (i > 0) doc.addPage(); drawReceipt(doc, r); });
  return doc;
}

/* ---------- Helpers de résolution côté front (pour l'aperçu/éligibilité) ---------- */

/** Somme des paiements affectés à une échéance donnée. */
export function allocatedToDue(dueId, payments) {
  let sum = 0;
  for (const p of payments || []) {
    for (const a of p.allocations || []) {
      if (a.rent_due_id === dueId) sum = Math.round((sum + (Number(a.amount) || 0)) * 100) / 100;
    }
  }
  return sum;
}

/**
 * Éligibilité à la quittance pour un bail + une période, à partir du ledger.
 * Renvoie { kind: 'none'|'partial'|'full', due, paid, balance }.
 */
export function resolveEligibility(leaseId, dues, payments, { year, month }) {
  const due = (dues || []).find(
    (d) => d.lease_id === leaseId && Number(d.year) === year && Number(d.month) === month
  );
  if (!due) return { kind: 'none', reason: 'no_due', paid: 0, balance: 0, due: null };
  const totalDue = Math.round((Number(due.total_due) || 0) * 100) / 100;
  const paid = allocatedToDue(due.id, payments);
  const balance = Math.round((totalDue - paid) * 100) / 100;
  let kind = 'full';
  if (paid <= 0) kind = 'none';
  else if (paid < totalDue) kind = 'partial';
  return { kind, paid, balance, totalDue, due };
}

/* ---------- Rendu PDF ---------- */

function drawReceipt(doc, r) {
  const pageW = 210;
  const m = 16;
  const w = pageW - m * 2;
  let y = 20;
  const partial = r.kind === 'partial';

  // Bandeau titre
  doc.setFillColor(30, 58, 138);
  doc.rect(m, y - 7, w, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(partial ? 'REÇU POUR PAIEMENT PARTIEL' : 'QUITTANCE DE LOYER', pageW / 2, y + 4, { align: 'center' });
  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`N° ${r.receipt_number}   ·   Période : ${r.periodLabel}`, pageW / 2, y, { align: 'center' });
  y += 8;

  // Blocs Bailleur / Locataire
  const blockH = 30;
  const gap = 6;
  const colW = (w - gap) / 2;
  drawBlock(doc, m, y, colW, blockH, 'BAILLEUR', r.landlordName, r.landlordAddress);
  drawBlock(doc, m + colW + gap, y, colW, blockH, 'LOCATAIRE', r.tenantName, r.tenantAddress);
  y += blockH + 5;

  // Logement
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Logement : ${r.propertyName} — ${r.lotDesignation}`, m, y);
  y += 5;
  if (r.lotAddress) { doc.text(`Adresse : ${r.lotAddress}`, m, y); y += 5; }
  y += 5;

  // Tableau de décomposition
  y = drawTable(doc, m, y, w, r, partial);
  y += 7;

  // Paiement réel
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(partial ? 'Paiement reçu :' : 'Paiement encaissé :', m, y);
  doc.setFont('helvetica', 'normal');
  const payLbl = [
    r.paymentDate ? `le ${new Date(r.paymentDate).toLocaleDateString('fr-FR')}` : '',
    r.paymentMethod ? `(${r.paymentMethod})` : '',
  ].filter(Boolean).join(' ');
  doc.text(payLbl || '—', m + 38, y);
  y += 9;

  // Mention légale (centralisée, figée dans le snapshot)
  if (r.legalNote) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    const lines = doc.splitTextToSize(r.legalNote, w);
    doc.text(lines, m, y);
    y += lines.length * 3.6 + 6;
  }

  // Date d'émission
  const today = r.issueDate ? new Date(r.issueDate).toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Fait le ${today}`, m, y);
  y += 6;

  // Signature
  const sigW = 70;
  const sigX = m + w - sigW;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Signature du bailleur', sigX, y);
  y += 6;
  doc.setDrawColor(120);
  doc.setLineWidth(0.3);
  doc.line(sigX, y, sigX + sigW, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(r.landlordName || '', sigX, y);
}

function drawBlock(doc, x, y, w, h, label, name, address) {
  doc.setFillColor(238, 242, 248);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(90, 100, 120);
  doc.text(label, x + 2, y + 4);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(name || '—', x + 2, y + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(address || '', w - 4);
  doc.text(lines.slice(0, 3), x + 2, y + 15);
}

function drawTable(doc, m, y, w, r, partial) {
  const rows = [
    ['Loyer hors charges', r.rentHc],
    ['Charges', r.charges],
  ];
  if (Number(r.additionalAmount) > 0) rows.push(['Provisions / frais supplémentaires', r.additionalAmount]);

  // En-tête
  doc.setFillColor(238, 242, 248);
  doc.rect(m, y, w, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Désignation', m + 2, y + 5);
  doc.text('Montant', m + w - 2, y + 5, { align: 'right' });
  y += 8;

  doc.setDrawColor(200);
  doc.setLineWidth(0.3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  for (const row of rows) {
    doc.line(m, y, m + w, y);
    doc.text(String(row[0]), m + 2, y + 5);
    doc.text(fmtMoney(row[1]), m + w - 2, y + 5, { align: 'right' });
    y += 7;
  }

  // Total dû
  doc.line(m, y, m + w, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('TOTAL DÛ', m + 2, y + 5);
  doc.text(fmtMoney(r.totalDue), m + w - 2, y + 5, { align: 'right' });
  y += 7;

  // Montant payé (réel)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(partial ? 'MONTANT PAYÉ (reçu)' : 'TOTAL PAYÉ', m + 2, y + 5);
  doc.text(fmtMoney(r.paidAmount), m + w - 2, y + 5, { align: 'right' });
  y += 1;

  if (partial) {
    y += 6;
    doc.line(m, y, m + w, y);
    doc.setFillColor(179, 36, 36);
    doc.rect(m, y, w, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('RESTE À PAYER', m + 2, y + 6);
    doc.text(fmtMoney(r.balance > 0 ? r.balance : 0), m + w - 2, y + 6, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += 9;
  } else {
    doc.setFillColor(30, 58, 138);
    doc.rect(m, y, w, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('SOLDE', m + 2, y + 6);
    doc.text(fmtMoney(0).replace('-', ''), m + w - 2, y + 6, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += 9;
  }
  doc.line(m, y, m + w, y);
  return y;
}