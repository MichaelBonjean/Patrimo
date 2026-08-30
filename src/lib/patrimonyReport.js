// Générateur du "Dossier de valorisation patrimoniale" — PDF A4 imprimable.
// 1. Page de garde · 2. Synthèse · 3. Répartition (donuts) · 4. Fiches par bien · 5. Annexes
// Tables dessinées à la main (jsPDF natif) — jspdf-autotable incompatible avec jspdf@4.
import { jsPDF } from 'jspdf';
import {
  formatCurrency, formatCurrencyDecimal, formatPercent, formatDateFR,
  calcTotalAcquisition, calcTotalMonthlyPayment, calcTotalAnnualCharges,
} from '@/lib/formatters';
import { currentCRD, getMonthlyPayment, buildSchedule } from '@/lib/loanEngine';
import { base44 } from '@/api/base44Client';
import { computePropertyPerformance, computePortfolioPerformance } from '@/lib/performanceEngine';

const C = {
  ink: [15, 23, 42], muted: [100, 116, 139], primary: [37, 99, 235],
  border: [203, 213, 225], light: [241, 245, 249],
  positive: [22, 163, 74], negative: [220, 38, 38], white: [255, 255, 255],
  gold: [180, 140, 40],
};
const PALETTE = ['#2563eb', '#7c3aed', '#16a34a', '#ea580c', '#db2777', '#0d9488', '#4f46e5', '#65a30d', '#dc2626', '#0891b2'];
const hexToRgb = (hex) => {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
};

// ---- Pré-chargement d'images (logo + photos) ----
function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
const IMG_EXT = /\.(png|jpe?g)(\?|$)/i;
const imgFormat = (url) => (/\.png(\?|$)/i.test(url) ? 'PNG' : 'JPEG');
function drawImageContain(doc, img, x, y, w, h) {
  if (!img) return false;
  const ar = img.naturalWidth / img.naturalHeight || 1.5;
  let dw = w, dh = w / ar;
  if (dh > h) { dh = h; dw = h * ar; }
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
  try { doc.addImage(img, imgFormat(img.src), dx, dy, dw, dh, undefined, 'FAST'); return true; }
  catch { return false; }
}

export async function generatePatrimoineReport({
  properties, lots, allLinks = [], allHolders = [],
  ownerName, ownerId, logoUrl,
}) {
  if (!properties || properties.length === 0) throw new Error('Aucun bien à exporter');

  // Données annexes (baux, quittances, documents photos, transactions)
  let leases = [], quittances = [], documents = [], transactions = [];
  if (ownerId) {
    try {
      [leases, quittances, documents, transactions] = await Promise.all([
        base44.entities.Lease.filter({ owner_id: ownerId }),
        base44.entities.Quittance.filter({ owner_id: ownerId }),
        base44.entities.Document.filter({ owner_id: ownerId }),
        base44.entities.Transaction.filter({ owner_id: ownerId, year: new Date().getFullYear() }),
      ]);
    } catch { /* isolé — on continue sans annexes */ }
  }

  // Pré-charge le logo + une photo par bien
  const logoImg = await loadImage(logoUrl);
  const photoByProp = {};
  await Promise.all(properties.map(async (p) => {
    const imgs = documents.filter((d) => d.property_id === p.id && IMG_EXT.test(d.file_url || ''));
    if (imgs.length) {
      // Préfère un document tagué/titré "photo", sinon le 1er
      const pick = imgs.find((d) => /photo/i.test((d.title || '') + (d.tags || []).join())) || imgs[0];
      photoByProp[p.id] = await loadImage(pick.file_url);
    }
  }));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, H = 297, ML = 18, MR = 18, MT = 26, bottomLimit = H - 26;
  const CW = W - ML - MR, footerY = H - 14;
  const S = { y: MT };
  const genDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  // ---- helpers ----
  const setFont = (size = 9, style = 'normal') => { doc.setFontSize(size); doc.setFont('helvetica', style); };
  const text = (str, x, y, opts = {}) => {
    doc.setTextColor(...(opts.color || C.ink));
    setFont(opts.size || 9, opts.style || 'normal');
    doc.text(String(str ?? ''), x, y, { baseline: 'middle', align: opts.align || 'left' });
  };
  const clip = (str, maxW, size = 9, style = 'normal') => {
    setFont(size, style);
    const lines = doc.splitTextToSize(String(str ?? ''), maxW);
    return lines[0] || '';
  };
  const div = (y) => { doc.setDrawColor(...C.border); doc.setLineWidth(0.2); doc.line(ML, y, W - MR, y); };
  const ensure = (need) => { if (S.y + need > bottomLimit) { doc.addPage(); S.y = MT; } };
  const newPage = () => { doc.addPage(); S.y = MT; };
  const section = (title) => {
    ensure(14);
    doc.setFillColor(...C.light);
    doc.roundedRect(ML, S.y, CW, 9, 1.5, 1.5, 'F');
    text(title, ML + 3, S.y + 4.6, { size: 10.5, style: 'bold', color: C.primary });
    S.y += 15;
  };
  const kpi = (x, y, w, h, label, value, sub, vColor) => {
    doc.setDrawColor(...C.border); doc.setLineWidth(0.2); doc.setFillColor(...C.white);
    doc.roundedRect(x, y, w, h, 2, 2, 'FD');
    text(label, x + 3, y + 4.2, { size: 7.5, color: C.muted });
    text(value, x + 3, y + 10.5, { size: 11.5, style: 'bold', color: vColor || C.ink });
    if (sub) text(sub, x + 3, y + 15.2, { size: 7, color: C.muted });
  };
  const kv = (label, value, y, { vColor } = {}) => {
    text(label, ML, y, { size: 9, color: C.muted });
    text(value, ML + 58, y, { size: 9.3, color: vColor });
  };

  // ---- table manuelle (répète l'en-tête sur saut de page) ----
  const renderTable = ({ x = ML, widths, headers, rows, fontSize = 8, rowH = 6, headerH = 7, aligns = [] }) => {
    const totalW = widths.reduce((a, b) => a + b, 0);
    const head = () => {
      doc.setFillColor(...C.light); doc.rect(x, S.y, totalW, headerH, 'F');
      let cx = x;
      headers.forEach((h, i) => {
        const ax = aligns[i] || 'left';
        const tx = ax === 'right' ? cx + widths[i] - 2 : cx + 2;
        text(h, tx, S.y + headerH / 2, { size: fontSize, style: 'bold', color: C.muted, align: ax });
        cx += widths[i];
      });
      S.y += headerH; div(S.y); S.y += 1.5;
    };
    head();
    rows.forEach((row) => {
      if (S.y + rowH > bottomLimit) { doc.addPage(); S.y = MT; head(); }
      let cx = x;
      row.forEach((cell, i) => {
        const ax = aligns[i] || 'left';
        const tx = ax === 'right' ? cx + widths[i] - 2 : cx + 2;
        text(cell ?? '', tx, S.y + rowH / 2, { size: fontSize, align: ax });
        cx += widths[i];
      });
      S.y += rowH; div(S.y); S.y += 1.5;
    });
  };

  // ---- donut ----
  const donut = (cx, cy, r, rIn, entries) => {
    const total = entries.reduce((s, e) => s + e.value, 0) || 1;
    let a = -Math.PI / 2;
    entries.forEach((e, i) => {
      if (e.value <= 0) return;
      const ang = (e.value / total) * 2 * Math.PI;
      const steps = Math.max(2, Math.ceil(ang / 0.08));
      doc.setFillColor(...hexToRgb(e.color || PALETTE[i % PALETTE.length]));
      for (let k = 0; k < steps; k++) {
        const a0 = a + (ang * k) / steps, a1 = a + (ang * (k + 1)) / steps;
        doc.triangle(cx, cy, cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(a1), cy + r * Math.sin(a1), 'F');
      }
      a += ang;
    });
    doc.setFillColor(...C.white); doc.circle(cx, cy, rIn, 'F');
    doc.setTextColor(...C.ink); setFont(10, 'bold');
    doc.text(formatCurrency(total), cx, cy, { baseline: 'middle', align: 'center' });
  };
  const legend = (entries, x, y) => {
    entries.forEach((e, i) => {
      if (i > 9) return;
      const total = entries.reduce((s, en) => s + en.value, 0) || 1;
      doc.setFillColor(...hexToRgb(e.color || PALETTE[i % PALETTE.length]));
      doc.roundedRect(x, y - 2.6, 3.2, 3.2, 0.5, 0.5, 'F');
      text(clip(e.label, 44), x + 5, y, { size: 8.5 });
      text(`${total ? formatPercent((e.value / total) * 100, 1) : '—'}`, x + 52, y, { size: 8.3, color: C.muted, align: 'right' });
      y += 6.2;
    });
  };
  const groupBy = (props, keyFn) => {
    const map = {};
    for (const p of props) {
      const k = keyFn(p) || 'Non renseigné';
      const v = p.estimated_value || calcTotalAcquisition(p);
      map[k] = (map[k] || 0) + v;
    }
    return Object.entries(map).map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] })).sort((a, b) => b.value - a.value);
  };
  const holderGroups = () => {
    const map = {}; const linked = new Set();
    for (const l of allLinks) {
      const p = properties.find((x) => x.id === l.property_id); if (!p) continue;
      linked.add(p.id);
      const v = (p.estimated_value || calcTotalAcquisition(p)) * ((l.share_percent || 100) / 100);
      const h = allHolders.find((x) => x.id === l.holder_id);
      const k = h?.name || 'Inconnu';
      map[k] = (map[k] || 0) + v;
    }
    for (const p of properties) if (!linked.has(p.id)) {
      const k = 'Propriétaire direct';
      map[k] = (map[k] || 0) + (p.estimated_value || calcTotalAcquisition(p));
    }
    return Object.entries(map).map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] })).sort((a, b) => b.value - a.value);
  };

  // ===================== PAGE 1 — GARDE =====================
  if (logoImg) drawImageContain(doc, logoImg, ML, 16, 34, 14);
  doc.setFillColor(...C.primary); doc.rect(ML, 38, 3, 22, 'F');
  text('DOSSIER PATRIMONIAL', ML + 7, 46, { size: 22, style: 'bold' });
  text('de ' + ownerName, ML + 7, 54, { size: 13, color: C.muted });
  text('au ' + genDate, ML + 7, 60, { size: 11, color: C.muted });

  // Détenteur principal (SCI si présente)
  const sci = allHolders.find((h) => /SCI/i.test(h.type || '') && h.siret) || allHolders[0];
  S.y = 78;
  if (sci) {
    text('Détenteur', ML, S.y, { size: 8, color: C.muted, style: 'bold' });
    S.y += 6;
    text(sci.name || '—', ML, S.y, { size: 11, style: 'bold' });
    if (sci.type) text(sci.type, ML, S.y + 5.5, { size: 9, color: C.muted });
    S.y += 13;
    if (sci.siret) text('SIREN ' + sci.siret.slice(0, 9), ML, S.y, { size: 9, color: C.muted });
    if (sci.siret) S.y += 6;
    if (sci.address) { text(clip(sci.address, CW), ML, S.y, { size: 9, color: C.muted }); S.y += 6; }
  }

  // Bloc sommaire
  S.y = Math.max(S.y + 6, 150);
  section('Sommaire');
  const sommaire = [
    '1 — Synthèse patrimoniale', '2 — Répartition (catégorie, ville, régime, détenteurs)',
    '3 — Fiche par bien', '4 — Annexes (prêts, quittances, baux)',
  ];
  sommaire.forEach((l, i) => {
    text(l, ML, S.y, { size: 10, style: i < 2 ? 'normal' : 'normal' });
    S.y += 7;
  });

  // pied de page de garde
  text('Document confidentiel — préparé avec Patrimo', ML, H - 40, { size: 8.5, color: C.muted, style: 'italic' });

  // ===================== PAGE 2 — SYNTHÈSE =====================
  newPage();
  doc.setFillColor(...C.primary); doc.rect(ML, 16, 3, 10, 'F');
  text('1. Synthèse patrimoniale', ML + 7, 21, { size: 13, style: 'bold' });
  S.y = 34;

  const totalAcq = properties.reduce((s, p) => s + calcTotalAcquisition(p), 0);
  const totalEst = properties.reduce((s, p) => s + (p.estimated_value || calcTotalAcquisition(p)), 0);
  const totalCRD = properties.reduce((s, p) => s + currentCRD(p), 0);
  const net = totalEst - totalCRD;
  // Rentabilité canonique (performanceEngine) — même source que Dashboard/Analyse/PropertyDetail.
  const portPerf = computePortfolioPerformance({ properties, transactions, year: new Date().getFullYear(), leases, lots });
  const annualRent = portPerf.rentalIncome;
  const annualCharges = portPerf.nonRecoverableOpEx;
  const noi = portPerf.noi;
  const monthlyRent = Math.round(annualRent / 12);
  const monthlyDebt = properties.reduce((s, p) => s + calcTotalMonthlyPayment(p), 0);
  const annualDebt = monthlyDebt * 12;
  const annualCashflow = noi - annualDebt;
  const ltv = totalEst > 0 ? (totalCRD / totalEst) * 100 : 0;
  const dscr = annualDebt > 0 ? noi / annualDebt : null;
  const grossY = portPerf.grossYield;
  const netY = portPerf.netYield;

  const cw = (CW - 2 * 4) / 3, ch = 19, gap = 4;
  let cx = ML;
  kpi(cx, S.y, cw, ch, 'Patrimoine total', formatCurrency(totalEst), `${properties.length} bien(s)`); cx += cw + gap;
  kpi(cx, S.y, cw, ch, 'Dette restante', formatCurrency(totalCRD), 'Capital restant dû', C.negative); cx += cw + gap;
  kpi(cx, S.y, cw, ch, 'Patrimoine net', formatCurrency(net), 'Valeur − dette', C.positive);
  S.y += ch + gap; cx = ML;
  kpi(cx, S.y, cw, ch, 'Loyers HC annuels', formatCurrency(annualRent), `${formatCurrency(monthlyRent)} / mois`); cx += cw + gap;
  kpi(cx, S.y, cw, ch, 'Cash-flow annuel', formatCurrency(annualCashflow, true), 'NOI − dette', annualCashflow >= 0 ? C.positive : C.negative); cx += cw + gap;
  kpi(cx, S.y, cw, ch, 'Charges annuelles', formatCurrency(annualCharges), 'Foncière, PNO, gestion…', C.muted);
  S.y += ch + 4;

  // ratios
  const rw = (CW - 3 * 3) / 4;
  const ratios = [
    ['LTV', formatPercent(ltv), 'Dette / valeur'],
    ['DSCR', dscr != null ? dscr.toFixed(2).replace('.', ',') : '—', 'NOI / dette'],
    ['Rdt brut moyen', formatPercent(grossY), 'Loyers / acquisition'],
    ['Rdt net moyen', formatPercent(netY), '(Loyers − charges) / acq.'],
  ];
  ratios.forEach((r, i) => {
    const x = ML + (i % 4) * (rw + 3);
    doc.setDrawColor(...C.border); doc.setFillColor(...C.white); doc.roundedRect(x, S.y, rw, 16, 2, 2, 'FD');
    doc.setFillColor(...C.primary); doc.rect(x, S.y, rw, 1.5, 'F');
    text(r[0], x + 3, S.y + 6, { size: 7.5, color: C.muted, style: 'bold' });
    text(r[1], x + 3, S.y + 11.5, { size: 12.5, style: 'bold', color: C.primary });
    text(r[2], x + 3, S.y + 15.5, { size: 6.8, color: C.muted });
  });
  S.y += 22;

  // note
  ensure(12);
  doc.setFillColor(...C.light); doc.roundedRect(ML, S.y, CW, 11, 2, 2, 'F');
  text("Ce dossier présente la valorisation et la rentabilité de votre patrimoine immobilier. Il est destiné à appuyer une demande de financement ou une renégociation de prêt.", ML + 3, S.y + 6, { size: 8.5, color: C.muted });

  // ===================== PAGE 3 — RÉPARTITION =====================
  newPage();
  doc.setFillColor(...C.primary); doc.rect(ML, 16, 3, 10, 'F');
  text('2. Répartition du patrimoine', ML + 7, 21, { size: 13, style: 'bold' });
  S.y = 34;

  const charts = [
    { title: 'Par catégorie', entries: groupBy(properties, (p) => p.category) },
    { title: 'Par ville', entries: groupBy(properties, (p) => p.city) },
    { title: 'Par régime fiscal', entries: groupBy(properties, (p) => p.tax_regime) },
    { title: 'Par détenteur (quotes-parts)', entries: holderGroups() },
  ];
  const cellH = 62, cellW = CW / 2;
  charts.forEach((ch, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x0 = ML + col * cellW, y0 = 34 + row * cellH;
    doc.setDrawColor(...C.border); doc.setFillColor(...C.white); doc.roundedRect(x0, y0, cellW - 4, cellH - 6, 2, 2, 'FD');
    text(ch.title, x0 + 4, y0 + 6, { size: 10, style: 'bold', color: C.primary });
    donut(x0 + 32, y0 + 34, 13, 7.5, ch.entries);
    legend(ch.entries.slice(0, 8), x0 + 54, y0 + 14);
  });

  // ===================== PAGE 4..N — FICHIERS PAR BIEN =====================
  properties.forEach((p, idx) => {
    newPage();
    doc.setFillColor(...C.primary); doc.rect(ML, 16, 3, 10, 'F');
    text(`3.${idx + 1} — ${p.name}`, ML + 7, 21, { size: 13, style: 'bold' });
    text([p.category, p.tax_regime, p.holding_structure].filter(Boolean).join(' · '), ML + 7, 27, { size: 9, color: C.muted });
    S.y = 36;

    // Photo (si dispo)
    const photo = photoByProp[p.id];
    if (photo) {
      doc.setDrawColor(...C.border); doc.setFillColor(...C.light);
      doc.roundedRect(W - MR - 50, 36, 50, 32, 1.5, 1.5, 'FD');
      drawImageContain(doc, photo, W - MR - 49, 37, 48, 30);
    }

    // Identité
    text('Identité', ML, S.y, { size: 9.5, style: 'bold', color: C.primary }); S.y += 5; div(S.y); S.y += 4;
    const crd = currentCRD(p);
    const val = p.estimated_value || calcTotalAcquisition(p);
    const plusValue = (p.estimated_value || 0) - calcTotalAcquisition(p);
    const idRows = [
      ['Adresse', [p.address, p.postal_code, p.city].filter(Boolean).join(', ')],
      ['Catégorie', p.category], ['Régime fiscal', p.tax_regime],
      ['Structure de détention', p.holding_structure],
      ['SCI / structure', p.sci_name ? `${p.sci_name}${p.sci_siret ? ` · SIRET ${p.sci_siret}` : ''}` : '—'],
      ['Date d’acquisition', p.acquisition_date ? formatDateFR(p.acquisition_date) : '—'],
      ['Prix d’achat (coût total)', formatCurrency(calcTotalAcquisition(p))],
      ['Valeur estimée', formatCurrency(val)],
      ['Plus-value latente', p.estimated_value ? formatCurrency(plusValue, true) : '—', plusValue >= 0 ? C.positive : C.negative],
    ];
    idRows.forEach((r) => { kv(r[0], r[1], S.y, { vColor: r[2] }); S.y += 6; });

    // Financement
    S.y += 2; ensure(10);
    text('Financement', ML, S.y, { size: 9.5, style: 'bold', color: C.primary }); S.y += 5; div(S.y); S.y += 4;
    if (p.loan_amount && p.loan_start_date) {
      const sched = buildSchedule(p);
      const now = new Date();
      const remainingMonths = sched.filter((r) => r.date > now).length;
      const ltvP = val > 0 ? (crd / val) * 100 : 0;
      const finRows = [
        ['Capital emprunté', formatCurrency(p.loan_amount)],
        ['Taux nominal', p.loan_rate ? `${p.loan_rate.toString().replace('.', ',')} %` : '—'],
        ['Mensualité (hors ass.)', formatCurrency(getMonthlyPayment(p))],
        ['Assurance mensuelle', formatCurrency(p.monthly_insurance)],
        ['Mensualité totale', formatCurrency(calcTotalMonthlyPayment(p))],
        ['Reste dû (CRD)', formatCurrency(crd), C.negative],
        ['Durée restante', remainingMonths ? `${Math.floor(remainingMonths / 12)} ans ${remainingMonths % 12} mois` : 'Soldé'],
        ['LTV du bien', formatPercent(ltvP)],
        ['Banque', p.bank || '—'],
      ];
      finRows.forEach((r) => { kv(r[0], r[1], S.y, { vColor: r[2] }); S.y += 6; });
    } else {
      text('Aucun financement déclaré.', ML, S.y, { size: 8.5, color: C.muted, style: 'italic' }); S.y += 6;
    }

    // Loyers & occupation
    S.y += 2; ensure(10);
    text('Loyers & occupation', ML, S.y, { size: 9.5, style: 'bold', color: C.primary }); S.y += 5; div(S.y); S.y += 4;
    const propLots = lots.filter((l) => l.property_id === p.id);
    const occupied = propLots.filter((l) => !l.is_vacant);
    const rentM = occupied.reduce((s, l) => s + (l.rent_excluding_charges || 0), 0);
    const chargesM = occupied.reduce((s, l) => s + (l.charges || 0), 0);
    const tenants = occupied.map((l) => l.tenants?.[0]?.name || l.tenant_name).filter(Boolean);
    kv('Loyer HC mensuel', formatCurrency(rentM), S.y); S.y += 6;
    kv('Charges mensuelles', formatCurrency(chargesM), S.y); S.y += 6;
    kv('Loyer HC annuel', formatCurrency(rentM * 12), S.y); S.y += 6;
    kv('Occupation', `${occupied.length}/${propLots.length} lots occupés`, S.y); S.y += 6;
    kv('Locataire(s)', clip(tenants.join(', ') || '—', CW - 62), S.y); S.y += 6;

    // Indicateurs — rentabilité canonique (performanceEngine), même source que Dashboard/Analyse.
    S.y += 2; ensure(14);
    const pPerf = computePropertyPerformance({ property: p, transactions, year: new Date().getFullYear(), leases, lots: propLots });
    const cfM = Math.round(pPerf.theoreticalCashflow / 12);
    kpi(ML, S.y, cw, 16, 'Rendement brut', formatPercent(pPerf.grossYield), null, C.primary);
    kpi(ML + cw + 4, S.y, cw, 16, 'Rendement net', formatPercent(pPerf.netYield), null, C.primary);
    kpi(ML + 2 * (cw + 4), S.y, cw, 16, 'Cash-flow mensuel', formatCurrency(cfM, true), null, cfM >= 0 ? C.positive : C.negative);
    S.y += 20;
  });

  // ===================== ANNEXES =====================
  newPage();
  doc.setFillColor(...C.primary); doc.rect(ML, 16, 3, 10, 'F');
  text('4. Annexes', ML + 7, 21, { size: 13, style: 'bold' });
  S.y = 34;

  // A. Prêts + échéancier synthétique (12 prochaines échéances)
  section('A. Prêts en cours — échéancier synthétique (12 prochaines échéances)');
  const loanProps = properties.filter((p) => p.loan_amount && p.loan_start_date);
  if (!loanProps.length) { text('Aucun prêt en cours.', ML, S.y, { size: 8.5, color: C.muted, style: 'italic' }); S.y += 6; }
  loanProps.forEach((p) => {
    ensure(20);
    text(`Prêt — ${p.name}${p.bank ? ` (${p.bank})` : ''}`, ML, S.y, { size: 9.5, style: 'bold', color: C.primary }); S.y += 5;
    kv('Capital', formatCurrency(p.loan_amount), S.y); kv('Taux', p.loan_rate ? `${p.loan_rate.toString().replace('.', ',')} %` : '—', S.y); S.y += 6;
    const sched = buildSchedule(p);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const upcoming = sched.filter((r) => r.date >= now).slice(0, 12);
    ensure(8 + upcoming.length * 6);
    renderTable({
      widths: [10, 22, 25, 24, 25, 24],
      headers: ['N°', 'Échéance', 'Date', 'Capital', 'Intérêts', 'CRD'],
      rows: upcoming.map((r) => [r.number, formatCurrencyDecimal(r.payment), r.date.toLocaleDateString('fr-FR', { month: '2-digit', year: '2-digit' }), formatCurrencyDecimal(r.principal), formatCurrencyDecimal(r.interest), formatCurrencyDecimal(r.remaining)]),
      aligns: ['left', 'right', 'left', 'right', 'right', 'right'],
      fontSize: 7.5, rowH: 5.5,
    });
    S.y += 4;
  });

  // B. Quittances de l'année en cours
  ensure(20);
  section('B. Quittances émises (année en cours)');
  const year = new Date().getFullYear();
  const yearQuittances = quittances.filter((q) => q.year === year);
  if (!yearQuittances.length) { text('Aucune quittance émise cette année.', ML, S.y, { size: 8.5, color: C.muted, style: 'italic' }); S.y += 6; }
  else {
    renderTable({
      widths: [22, 30, 34, 16, 22, 22, 22],
      headers: ['N° quittance', 'Bien', 'Locataire', 'Période', 'Type', 'Total dû', 'Encaissé'],
      rows: yearQuittances.sort((a, b) => (b.period || '').localeCompare(a.period || '')).map((q) => [
        clip(q.receipt_number || '—', 20), clip(q.property_name || '—', 28), clip(q.tenant_name || '—', 32),
        q.period || '—', q.kind === 'partial' ? 'Partielle' : 'Intégrale',
        formatCurrency(q.total_due || 0), formatCurrency(q.paid_amount || 0),
      ]),
      aligns: ['left', 'left', 'left', 'left', 'left', 'right', 'right'],
      fontSize: 7.2, rowH: 5.5,
    });
    S.y += 4;
  }

  // C. Baux actifs
  ensure(20);
  section('C. Baux actifs');
  const activeLeases = leases.filter((l) => l.status === 'actif');
  if (!activeLeases.length) { text('Aucun bail actif.', ML, S.y, { size: 8.5, color: C.muted, style: 'italic' }); S.y += 6; }
  else {
    const propById = (id) => properties.find((p) => p.id === id);
    const lotById = (id) => lots.find((l) => l.id === id);
    renderTable({
      widths: [28, 24, 30, 18, 18, 20, 18],
      headers: ['Bien', 'Lot', 'Locataire(s)', 'Type', 'Début', 'Loyer HC', 'Charges'],
      rows: activeLeases.map((l) => {
        const p = propById(l.property_id), lot = lotById(l.lot_id);
        const tnames = (l.tenants || []).map((t) => t.name).join(', ') || lot?.tenant_name || '—';
        return [clip(p?.name || '—', 26), clip(lot?.designation || '—', 22), clip(tnames, 28), l.lease_type || '—', l.date_start ? formatDateFR(l.date_start) : '—', formatCurrency(l.rent_excluding_charges || 0), formatCurrency(l.charges || 0)];
      }),
      aligns: ['left', 'left', 'left', 'left', 'left', 'right', 'right'],
      fontSize: 7.2, rowH: 5.5,
    });
  }

  // ===================== PIED DE PAGE (toutes pages) =====================
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...C.border); doc.setLineWidth(0.2);
    doc.line(ML, footerY - 4, W - MR, footerY - 4);
    doc.setFillColor(...C.primary); doc.circle(ML + 1.5, footerY, 1.2, 'F');
    setFont(7.5, 'normal'); doc.setTextColor(...C.muted);
    doc.text('Patrimo', ML + 5, footerY, { baseline: 'middle' });
    doc.text(`Généré le ${genDate}`, ML + 28, footerY, { baseline: 'middle' });
    if (logoImg) doc.text('— ' + ownerName, ML + 72, footerY, { baseline: 'middle' });
    doc.text(`Page ${i} / ${total}`, W / 2, footerY, { baseline: 'middle', align: 'center' });
    doc.text('Confidentiel', W - MR, footerY, { baseline: 'middle', align: 'right' });
  }

  const fileName = `Dossier_patrimonial_${ownerName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
  return fileName;
}