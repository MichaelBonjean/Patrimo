// Génération du document de régularisation des charges (PDF A4 portrait, sobre).
import { jsPDF } from 'jspdf';

const fmt = (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

export function generateChargeRegularizationPDF(rec) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = 18;
  const left = 16;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Régularisation des charges locatives', left, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`Période : ${rec.period || rec.year}`, left, y); y += 8;

  doc.setFontSize(10);
  doc.text('Bailleur', left, y); doc.text('Locataire', W / 2, y); y += 5;
  doc.setFontSize(9);
  doc.text(rec.landlord_name || '—', left, y); doc.text(rec.tenant_name || '—', W / 2, y); y += 5;
  doc.text('Bien : ' + (rec.property_name || '—'), left, y);
  doc.text('Logement : ' + (rec.lot_designation || '—'), W / 2, y); y += 5;
  doc.text('Adresse : ' + (rec.lot_address || '—'), left, y); y += 9;

  // Ventilation
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Ventilation des charges récupérables', left, y); y += 6;
  doc.setFontSize(9);
  doc.setFillColor(241, 245, 249);
  doc.rect(left, y - 4, W - left * 2, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.text('Catégorie', left + 1, y); doc.text('Montant', W - left - 1 - 22, y); y += 6;
  doc.setFont('helvetica', 'normal');
  (rec.ventilation || []).forEach((v) => {
    doc.text((v.category_label || v.category || '').slice(0, 60), left + 1, y);
    doc.text(fmt(v.amount), W - left - 1, y, { align: 'right' });
    y += 5;
    if (y > 270) { doc.addPage(); y = 18; }
  });
  y += 2;
  doc.setDrawColor(203, 213, 225); doc.line(left, y, W - left, y); y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Total charges récupérables', left + 1, y); doc.text(fmt(rec.recoverable_total), W - left - 1, y, { align: 'right' }); y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text('Total provisions encaissées', left + 1, y); doc.text(fmt(rec.provisions_collected), W - left - 1, y, { align: 'right' }); y += 8;

  // Solde
  const directionTxt = rec.direction === 'du_locataire'
    ? `Solde dû par le locataire : ${fmt(rec.solde)}`
    : rec.direction === 'rembourser_locataire'
      ? `Solde à rembourser au locataire : ${fmt(Math.abs(rec.solde))}`
      : 'Régularisation nulle — aucun solde.';
  doc.setFillColor(222, 247, 230); doc.rect(left, y - 4, W - left * 2, 8, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(directionTxt, left + 1, y + 1); y += 12;

  // Justificatifs
  if ((rec.justificatifs || []).length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Justificatifs conservés', left, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    (rec.justificatifs || []).forEach((f) => {
      doc.text('• ' + (f.filename || f.url), left + 2, y); y += 5;
    });
    y += 3;
  }

  doc.setFontSize(8); doc.setTextColor(100);
  doc.text('Document de régularisation pour information du locataire — ne constitue pas une quittance de loyer.', left, 280);

  doc.save(`regularisation-charges-${rec.period || rec.year}.pdf`);
}