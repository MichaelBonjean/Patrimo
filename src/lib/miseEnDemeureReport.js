import { jsPDF } from 'jspdf';

function fmtEuro(n) {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(v);
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric'
  });
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function periodLabel(period) {
  if (!period) return '—';
  const [year, month] = period.split('-').map(Number);
  return month ? `${MONTHS[month - 1]} ${year}` : period;
}

/**
 * Génère une lettre de mise en demeure PDF conforme, prévue pour envoi
 * en Lettre Recommandée avec Accusé de Réception (LRAR).
 */
export function buildMiseEnDemeure(data, landlordName) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = 210;
  const m = 22;
  const w = pageW - m * 2;
  let y = 25;

  // Émetteur (bailleur)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text((landlordName || 'Le bailleur').toUpperCase(), m, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (data.landlord_address) {
    const lines = doc.splitTextToSize(data.landlord_address, 70);
    doc.text(lines, m, y + 4);
  }
  y += 18;

  // Destinataire (locataire)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text((data.tenant_name || 'Le locataire').toUpperCase(), m + w - 75, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const destLines = doc.splitTextToSize(data.tenant_address || '', 75);
  doc.text(destLines, m + w - 75, y + 4);
  y += 22;

  // Lieu + date
  const today = new Date();
  const lieu = data.landlord_address ? data.landlord_address.split(',').pop().trim() : '';
  doc.text(`Fait à ${lieu || '—'}, le ${today.toLocaleDateString('fr-FR')}`, m, y);
  y += 10;

  // Objet
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Objet : MISE EN DEMEURE DE PAYER', m, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Logement : ${data.property_name || ''} — ${data.lot_designation || ''}`, m, y);
  doc.text(`Adresse : ${data.lot_address || ''}`, m, y + 5);
  y += 14;

  // Corps
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const intro = `Madame, Monsieur,`;
  doc.text(intro, m, y);
  y += 7;

  const para1 = `Malgré ma relance précédente, je constate que le loyer de ${periodLabel(data.period)} pour le logement dont vous êtes locataire demeure impayé à hauteur de ${fmtEuro(data.missing_amount)} (sur un loyer mensuel de ${fmtEuro(data.expected_amount)}), dont la quittance n'a pas été réglée.`;
  y = writePara(doc, para1, m, y, w);

  const para2 = `Par la présente, je vous mets en demeure de procéder au règlement de la somme de ${fmtEuro(data.missing_amount)} dans un délai de QUINZE (15) JOURS à compter de la réception de la présente, soit au plus tard le ${computeDeadline(today, 15)}.`;
  y = writePara(doc, para2, m, y, w);

  const para3 = `À défaut de règlement dans ce délai, et conformément aux articles 2229 et 2241 du Code civil ainsi qu'aux dispositions de la loi n° 89-462 du 6 juillet 1989 modifiée tendant à améliorer les rapports locatifs, je me verrai contraint(e) d'engager la procédure de résiliation judiciaire du bail et la procédure d'expulsion vous concernant, et de saisir la juridiction compétente pour obtenir le paiement des sommes dues, des intérêts au taux légal et la réparation du préjudice subi.`;
  y = writePara(doc, para3, m, y, w);

  const para4 = `Je vous remercie de bien vouloir tenir compte du caractère sérieux de la présente notification, établie pour faire valoir ce que de droit.`;
  y = writePara(doc, para4, m, y, w);
  y += 8;

  // Signature
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Le bailleur', m, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text((landlordName || ''), m, y);
  y += 12;

  // Bloc LRAR
  doc.setDrawColor(120, 120, 120);
  doc.setLineWidth(0.3);
  doc.roundedRect(m, y, w, 18, 1.5, 1.5, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('RECOMMANDÉ AVEC ACCUSÉ DE RÉCEPTION (LRAR)', m + 2, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('À envoyer en courrier recommandé avec accusé de réception.', m + 2, y + 10);
  doc.text(`N° de suivi : ________________________   Date d'envoi : ____________`, m + 2, y + 14);

  return doc;
}

function writePara(doc, text, m, y, w) {
  const lines = doc.splitTextToSize(text, w);
  const lineH = 5;
  const maxHeight = 270;
  lines.forEach((line, i) => {
    if (y > maxHeight) {
      doc.addPage();
      y = 25;
    }
    doc.text(line, m, y);
    y += lineH;
  });
  return y + 3;
}

function computeDeadline(today, days) {
  const d = new Date(today.getTime() + days * 86400000);
  return d.toLocaleDateString('fr-FR');
}