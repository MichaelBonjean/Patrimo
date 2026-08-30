/**
 * Génération PDF (jsPDF) des courriers de recouvrement et du dossier de
 * transmission. Le contenu textuel provient exclusivement de
 * `recouvrementTemplates.js` (modèles centralisés).
 *
 * Aucun acte de procédure n'est produit ici : les courriers sont des documents
 * bailleur, et le dossier est un dossier de transmission (pas un commandement
 * de payer).
 */
import jsPDF from 'jspdf';
import { formatEuro, fmtDate, periodLabel, DISCLAIMER_PROFESSIONNEL } from './recouvrementTemplates';

const PAGE = { w: 210, h: 297, margin: 20, lineHeight: 6 };

function newDoc() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFont('helvetica', 'normal');
  return doc;
}

function writeLines(doc, lines, x, y, maxW, lh = PAGE.lineHeight, fontSize = 10.5) {
  doc.setFontSize(fontSize);
  let yy = y;
  for (const raw of lines) {
    const text = String(raw ?? '');
    if (text === '') { yy += lh * 0.5; continue; }
    const wrapped = doc.splitTextToSize(text, maxW);
    for (const wline of wrapped) {
      if (yy > PAGE.h - PAGE.margin - 6) { doc.addPage(); yy = PAGE.margin; }
      doc.text(wline, x, yy);
      yy += lh;
    }
  }
  return yy;
}

function footer(doc, pageNum) {
  const total = doc.getNumberOfPages();
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`${pageNum}/${total}`, PAGE.w / 2, PAGE.h - 8, { align: 'center' });
  doc.setTextColor(0, 0, 0);
}

function headerBlock(doc, ctx, title) {
  // En-tête adresse expéditeur + destinataire
  doc.setFontSize(9);
  writeLines(doc, [
    ctx.landlordName,
    ctx.landlordAddress || 'Adresse du bailleur',
  ], PAGE.margin, PAGE.margin + 6, 80, 4.5, 9);

  writeLines(doc, [
    ctx.tenantName || 'Locataire',
    ctx.tenantAddress || '',
    fmtDate(new Date()) + ' — ' + ctx.landlordEmail,
  ], PAGE.w - PAGE.margin - 80, PAGE.margin + 6, 80, 4.5, 9);

  // Titre
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  const ty = PAGE.margin + 34;
  writeLines(doc, [title], PAGE.margin, ty, PAGE.w - 2 * PAGE.margin, 6, 13);
  doc.setFont('helvetica', 'normal');
}

/** Construit le document PDF d'un courrier bailleur (renvoie le jsPDF, sans sauvegarder). */
export function buildCourrierDoc(docModel, ctx) {
  const doc = newDoc();
  headerBlock(doc, ctx, docModel.title);

  let y = PAGE.margin + 46;
  doc.setFont('helvetica', 'normal');
  y = writeLines(doc, [docModel.subject || ''], PAGE.margin, y, PAGE.w - 2 * PAGE.margin);
  y = writeLines(doc, docModel.intro || [], PAGE.margin, y + 2, PAGE.w - 2 * PAGE.margin);
  y = writeLines(doc, docModel.body, PAGE.margin, y + 2, PAGE.w - 2 * PAGE.margin);

  // Encadré dette
  y += 3;
  const boxY = y;
  doc.setDrawColor(214, 214, 214);
  doc.rect(PAGE.margin, boxY, PAGE.w - 2 * PAGE.margin, 20);
  doc.setFontSize(9);
  writeLines(doc, [
    'Synthèse de la dette locative',
    `• Période : ${ctx.periodLabel} (échéance ${fmtDate(ctx.dueDate)})`,
    `• Échéance : ${formatEuro(ctx.totalDue)} — réglé : ${formatEuro(ctx.paidAmount)} — reste à régler : ${formatEuro(ctx.outstanding)}`,
    `• Retard constaté : ${ctx.lateDays} jour${ctx.lateDays > 1 ? 's' : ''}`,
  ], PAGE.margin + 3, boxY + 5, PAGE.w - 2 * PAGE.margin - 6, 4);
  y = boxY + 20 + 4;

  y = writeLines(doc, docModel.signatory, PAGE.margin, y, PAGE.w - 2 * PAGE.margin);

  // Mention légale (footer note)
  y += 4;
  doc.setFontSize(7.5);
  doc.setTextColor(90, 90, 90);
  y = writeLines(doc, docModel.footerNote || [], PAGE.margin, y, PAGE.w - 2 * PAGE.margin, 3.6, 7.5);
  doc.setTextColor(0, 0, 0);

  for (let p = 1; p <= doc.getNumberOfPages(); p++) {
    doc.setPage(p); footer(doc, p);
  }
  return doc;
}

/** Génère (et ouvre/télécharge) un courrier bailleur. */
export function generateCourrierPDF(docModel, ctx, filename) {
  buildCourrierDoc(docModel, ctx).save(filename);
}

/**
 * Génère le DOSSIER DE TRANSMISSION (à remettre à un commissaire de justice
 * ou avocat). N'est pas un acte — c'est un dossier de données destiné au
 * professionnel.
 */
export function generateDossierPDF(dossier, filename) {
  const doc = newDoc();
  const { ctx, lease, property, lot, dues, payments, actions, solde } = dossier;
  const maxW = PAGE.w - 2 * PAGE.margin;

  // ----- page de garde -----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  writeLines(doc, ['Dossier de transmission — dette locative'], PAGE.margin, PAGE.margin + 10, maxW, 7, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);

  let y = PAGE.margin + 24;
  y = writeLines(doc, [
    `Locataire : ${ctx.tenantName}`,
    `Logement : ${ctx.propertyName}${ctx.lotDesignation ? ` — ${ctx.lotDesignation}` : ''} — ${ctx.tenantAddress}`,
    `Période concernée : ${ctx.periodLabel} (échéance ${fmtDate(ctx.dueDate)})`,
    `Date du dossier : ${fmtDate(new Date())}`,
  ], PAGE.margin, y, maxW);

  y += 3;
  y = writeLines(doc, ['Objet : transmission du dossier de la dette locative à un professionnel compétent (commissaire de justice / avocat).'], PAGE.margin, y, maxW);

  // Encadré avertissement
  y += 2;
  const dy = y;
  doc.setFillColor(254, 243, 199); doc.setDrawColor(234, 179, 8);
  doc.rect(PAGE.margin, dy, maxW, 22, 'F');
  doc.setFontSize(8.5);
  doc.setTextColor(120, 53, 15);
  const wrapped = doc.splitTextToSize(DISCLAIMER_PROFESSIONNEL, maxW - 8);
  doc.text(wrapped, PAGE.margin + 4, dy + 6, { lineHeightFactor: 1.4 });
  doc.setTextColor(0, 0, 0);
  y = dy + 24;

  // ----- bail -----
  doc.addPage();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  writeLines(doc, ['1 — Bail'], PAGE.margin, PAGE.margin + 10, maxW, 6, 13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
  y = writeLines(doc, [
    `Type de bail : ${lease?.lease_type || '—'}`,
    `Date d'effet : ${fmtDate(lease?.date_start)}`,
    `Échéance le : ${lease?.due_day || '?'} du mois`,
    `Loyer HC : ${formatEuro(lease?.rent_excluding_charges)} — Charges : ${formatEuro(lease?.charges)}`,
    `Caution : ${formatEuro(lease?.deposit)}`,
    `Statut : ${lease?.status || '—'}`,
  ], PAGE.margin, PAGE.margin + 22, maxW);

  // ----- coordonnées -----
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  writeLines(doc, ['2 — Coordonnées'], PAGE.margin, y + 6, maxW, 6, 13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
  y = writeLines(doc, [
    'Bailleur :',
    `${ctx.landlordName}${ctx.landlordAddress ? ' — ' + ctx.landlordAddress : ''}${ctx.landlordEmail ? ' — ' + ctx.landlordEmail : ''}`,
    '',
    'Locataire :',
    `${ctx.tenantName}${ctx.tenantEmail ? ' — ' + ctx.tenantEmail : ''}`,
    `Logement : ${ctx.tenantAddress}${ctx.lotDesignation ? ' (' + ctx.lotDesignation + ')' : ''}`,
  ], PAGE.margin, y + 14, maxW);

  // ----- historique échéances -----
  doc.addPage();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  writeLines(doc, ['3 — Historique des échéances'], PAGE.margin, PAGE.margin + 10, maxW, 6, 13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  drawTable(doc, PAGE.margin, PAGE.margin + 22,
    ['Période', 'Échéance', 'Dû', 'Réglé', 'Solde'],
    (dues || []).map((d) => [periodLabel(d.period), fmtDate(d.due_date), formatEuro(d.total_due), formatEuro(d.paid_amount), formatEuro(d.balance)]),
    [40, 35, 30, 30, 35], maxW);

  let yy = PAGE.margin + 22 + ((dues || []).length + 1) * 6 + 4;
  yy = writeLines(doc, [`Solde débiteur total de la dette locative : ${formatEuro(solde)}`], PAGE.margin, yy, maxW);

  // ----- historique paiements -----
  doc.addPage();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  writeLines(doc, ['4 — Historique des paiements'], PAGE.margin, PAGE.margin + 10, maxW, 6, 13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  drawTable(doc, PAGE.margin, PAGE.margin + 22,
    ['Date', 'Montant', 'Payeur', 'Moyen', 'Réf.'],
    (payments || []).map((p) => [fmtDate(p.date), formatEuro(p.amount), p.payer_type || '', p.method || '', p.reference || '']),
    [30, 30, 30, 35, 45], maxW);

  // ----- relances / actions -----
  doc.addPage();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  writeLines(doc, ['5 — Relances & actions horodatées'], PAGE.margin, PAGE.margin + 10, maxW, 6, 13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  drawTable(doc, PAGE.margin, PAGE.margin + 22,
    ['Date', 'Étape', 'Acteur', 'Méthode', 'Note'],
    (actions || []).map((a) => [fmtDate(a.date), a.label || a.stage || '', a.actor || '', a.method || '', a.note || '']),
    [26, 38, 22, 30, 54], maxW);

  // ----- justificatifs / documents générés -----
  doc.addPage();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  writeLines(doc, ['6 — Justificatifs & documents'], PAGE.margin, PAGE.margin + 10, maxW, 6, 13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
  writeLines(doc, [
    'Documents à joindre par le bailleur au dossier de transmission :',
    '• exemplaire du bail signé et avenants ;',
    '• état des lieux d\'entrée et de sortie ;',
    '• copie des quittances antérieures ;',
    '• preuve de l\'envoi des courriers et de leur réception (accusés LRAR, emails) ;',
    '• tout échange écrit avec le locataire.',
  ], PAGE.margin, PAGE.margin + 22, maxW);

  for (let p = 1; p <= doc.getNumberOfPages(); p++) { doc.setPage(p); footer(doc, p); }
  doc.save(filename);
}

function drawTable(doc, x, y, headers, rows, colW, maxW) {
  const lh = 6;
  // entête
  doc.setFillColor(241, 245, 249);
  doc.rect(x, y - 4, colW.reduce((a, b) => a + b, 0), lh, 'F');
  let xx = x;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  headers.forEach((h, i) => { doc.text(h, xx + 1, y); xx += colW[i]; });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  let yy = y + lh;
  for (const r of rows) {
    if (yy > PAGE.h - PAGE.margin - 6) { doc.addPage(); yy = PAGE.margin + lh; }
    xx = x;
    r.forEach((cell, i) => { doc.text(String(cell), xx + 1, yy); xx += colW[i]; });
    yy += lh;
  }
}