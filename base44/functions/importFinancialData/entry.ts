import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import * as XLSX from 'npm:xlsx@0.18.5';
import { labelOf } from '../../shared/financeCategories.ts';

// Normalise une chaîne pour comparaison floue.
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cherche, parmi les biens DU propriétaire appelant, celui dont le nom correspond flou à la feuille.
function matchPropertyToSheet(properties, sheetName) {
  const normSheet = normalize(sheetName);
  let found = properties.find(p => normalize(p.name) === normSheet);
  if (found) return found;
  found = properties.find(p => {
    const normProp = normalize(p.name);
    return normSheet.includes(normProp) || normProp.includes(normSheet);
  });
  return found || null;
}

// Clé naturelle d'idempotence d'une transaction (pour l'upsert).
function txKey(t) {
  return [t.property_id, t.lot_id || '', t.year, t.month, t.category, t.type].join('|');
}

export default async function(req: Request): Promise<Response> {
  console.log('=== importFinancialData (multi-tenant, v2) START ===');
  try {
    const base44 = createClientFromRequest(req);
    // 1) Authentification — l'identité est l'unique source de owner_id.
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const owner = user.email;

    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    if (!body || !body.file_url) {
      return Response.json({ error: 'file_url manquant' }, { status: 400 });
    }

    // 2) Lecture du fichier
    const fileRes = await fetch(body.file_url);
    if (!fileRes.ok) return Response.json({ error: 'Impossible de télécharger le fichier' }, { status: 400 });
    const bytes = await fileRes.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
    console.log('Feuilles:', workbook.SheetNames);

    // 3) ISOLATION — toutes les lectures globales sont remplacées par des filtres base owner_id.
    const properties = await svc.entities.Property.filter({ owner_id: owner });
    const existingLots = await svc.entities.Lot.filter({ owner_id: owner });
    const ownPropertyIds = new Set(properties.map(p => p.id));
    console.log('Biens du propriétaire:', properties.map(p => p.name));

    // Index des transactions existantes DU propriétaire (pour l'upsert). On restreint aux années
    // présentes dans le classeur si possible (économise la mémoire).
    const yearsSeen = new Set<number>();
    {
      const ws0 = workbook.Sheets[workbook.SheetNames[0]];
      if (ws0) {
        const rows = XLSX.utils.sheet_to_json(ws0, { header: 1, raw: true });
        for (let r = 0; r < Math.min(rows.length, 200); r++) {
          for (let c = 0; c < (rows[r]?.length || 0); c++) {
            const d = rows[r][c];
            if (d instanceof Date && !isNaN(d.getTime())) yearsSeen.add(d.getFullYear());
            else if (d && String(d).match(/^\d{4}$/)) yearsSeen.add(Number(String(d)));
          }
        }
      }
    }
    const txFilter: any = { owner_id: owner };
    if (yearsSeen.size > 0 && yearsSeen.size <= 6) txFilter.year = { $in: Array.from(yearsSeen) };
    const existingTx = await svc.entities.Transaction.filter(txFilter);
    const txIndex = new Map(existingTx.map(t => [txKey(t), t]));
    const ownLotIds = new Set(existingLots.map(l => l.id));

    // 4) clear_existing — INTENTION EXPLICITE, scope owner (+ période si fournie), journalisé.
    const clearReport = { requested: false, deleted: 0, log: [] as any[] };
    if (body.clear_existing === true) {
      clearReport.requested = true;
      const delFilter: any = { owner_id: owner };
      let scopeLabel = 'all';
      if (body.clear_period && /^\d{4}(-\d{2})?$/.test(body.clear_period)) {
        // clear_period au format 'YYYY' (toute l'année) ou 'YYYY-MM' (un mois)
        if (body.clear_period.length === 4) {
          delFilter.year = Number(body.clear_period);
          scopeLabel = `year=${body.clear_period}`;
        } else {
          const [yy, mm] = body.clear_period.split('-').map(Number);
          delFilter.year = yy;
          delFilter.month = mm;
          scopeLabel = `period=${body.clear_period}`;
        }
      }
      const toDelete = await svc.entities.Transaction.filter(delFilter);
      for (const t of toDelete) {
        try {
          await svc.entities.Transaction.delete(t.id);
          clearReport.deleted++;
          if (clearReport.log.length < 200) {
            clearReport.log.push({ id: t.id, year: t.year, month: t.month, category: t.category, amount: t.amount });
          }
        } catch (e) {
          // journalisation d'erreur de suppression, on continue
          console.warn('erreur suppression transaction', t.id, e.message);
        }
      }
      console.log(`clear_existing (${scopeLabel}): ${clearReport.deleted} transactions supprimées pour ${owner}`);
    }
    // NB: si clear_existing n'est pas true, on NE supprime RIEN — on fait un upsert.

    const parseDate = (v) => {
      if (!v) return null;
      if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
      const d = new Date(String(v));
      return isNaN(d.getTime()) ? null : d;
    };
    const getMonthYear = (v) => {
      const d = parseDate(v);
      if (!d) return null;
      return { month: d.getMonth() + 1, year: d.getFullYear() };
    };

    // Création de lot: TJS rattaché au propriétaire + is_demo hérité du bien parent.
    const findOrCreateLot = async (propertyId, designation, isDemo) => {
      let lot = existingLots.find(l =>
        l.property_id === propertyId &&
        normalize(l.designation) === normalize(designation)
      );
      if (!lot) {
        lot = await svc.entities.Lot.create({
          owner_id: owner,
          is_demo: !!isDemo,
          property_id: propertyId,
          designation
        });
        existingLots.push(lot);
        ownLotIds.add(lot.id);
        stats._lots_created++;
      }
      return lot;
    };

    const numVal = (v) => {
      if (v === null || v === undefined || v === '' || v === '-') return 0;
      const n = parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
      return isNaN(n) ? 0 : n;
    };
    const readSheet = (sheetName) => {
      const ws = workbook.Sheets[sheetName];
      if (!ws) return null;
      return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // Stats globales (rapport d'import)
    const stats = {
      _lots_created: 0,
      _lots_reused: 0,
      _tx_created: 0,
      _tx_updated: 0,
      _rows_ignored: 0,
      _errors: 0,
    };
    const errorList: string[] = [];
    const bySheet: any = {};
    const unmatchedSheets: string[] = [];

    // 5) Mapping feuille -> bien (uniquement parmi les biens du propriétaire)
    const sheetPropertyMap: any = {};
    for (const sheetName of workbook.SheetNames) {
      const prop = matchPropertyToSheet(properties, sheetName);
      if (prop) sheetPropertyMap[sheetName] = prop;
      else unmatchedSheets.push(sheetName);
    }

    // Mapping mot-clé → CLÉ stable canonique (cf. base44/shared/financeCategories.ts)
    const CATEGORY_MAP = {
      'echeance': 'loan_installment', 'pret': 'loan_installment', 'prêt': 'loan_installment',
      'assurance': 'property_insurance', 'pno': 'property_insurance',
      'edf': 'electricity', 'electricite': 'electricity', 'électricité': 'electricity',
      'internet': 'internet', 'gestion': 'management_fees', 'gestions': 'management_fees',
      'travaux': 'works', 'copro': 'condo_fees', 'copropriete': 'condo_fees',
      'sci': 'sci_fees', 'comptable': 'accounting_fees', 'notaire': 'notary_fees',
      'taxe': 'property_tax', 'fonciere': 'property_tax',
      'entretien': 'maintenance', 'chaudiere': 'maintenance', 'chaudières': 'maintenance',
      'autre': 'other_expense', 'divers': 'other_expense',
      'virement': 'internal_transfer',
    };
    const detectCategory = (cellVal) => {
      const norm = normalize(String(cellVal || ''));
      for (const [kw, cat] of Object.entries(CATEGORY_MAP)) {
        if (norm.includes(kw)) return cat;
      }
      return null;
    };

    for (const sheetName of workbook.SheetNames) {
      const prop = sheetPropertyMap[sheetName];
      if (!prop) { bySheet[sheetName] = { ignored: true, reason: 'no_matching_property' }; continue; }

      const data = readSheet(sheetName);
      if (!data || data.length < 2) { bySheet[sheetName] = { rows: 0 }; continue; }

      const propIsDemo = prop.is_demo || false;
      const creates: any[] = [];
      const updates: any[] = [];
      let sheetRows = 0, sheetIgnored = 0, sheetCreated = 0, sheetUpdated = 0, sheetErrors = 0;

      const propertyLots = existingLots.filter(l => l.property_id === prop.id);

      const headerRow = data[1] || [];
      const headerRow0 = data[0] || [];

      const dateColCandidates = [0, 1];
      let dateCol = 0;
      for (const dc of dateColCandidates) {
        for (let r = 2; r < Math.min(data.length, 6); r++) {
          if (data[r] && getMonthYear(data[r][dc])) { dateCol = dc; break; }
        }
      }

      const lotColMap: any = {};
      const expColMap: any = {};
      const virColIdxs: number[] = [];

      for (const hRow of [headerRow0, headerRow]) {
        for (let c = 0; c < hRow.length; c++) {
          const cellStr = String(hRow[c] || '').trim();
          if (!cellStr) continue;
          const normCell = normalize(cellStr);
          if (['mois', 'date', 'total', 'totaux'].some(w => normCell.includes(w))) continue;

          const matchedLot = propertyLots.find(l => {
            const normLot = normalize(l.designation);
            return normCell === normLot || normCell.includes(normLot) || normLot.includes(normCell);
          });
          if (matchedLot && !lotColMap[c]) { lotColMap[c] = matchedLot.id; continue; }

          const isUnitPattern = /^(t[1-9]|studio|local|logement|entrepôt|entrepot|box|cave|parking|souplex|garage|rez|rdc)/i.test(cellStr);
          if (isUnitPattern && !lotColMap[c] && !expColMap[c]) { lotColMap[c] = { pendingDesignation: cellStr }; continue; }

          if ((normCell.includes('virement') || normCell === 'virements') && !expColMap[c]) { virColIdxs.push(c); continue; }

          const cat = detectCategory(cellStr);
          if (cat && !expColMap[c] && !lotColMap[c]) {
            expColMap[c] = cat === 'internal_transfer' ? null : cat;
            if (cat === 'internal_transfer') virColIdxs.push(c);
          }
        }
      }

      for (const [col, info] of Object.entries(lotColMap)) {
        if (info && typeof info === 'object' && info.pendingDesignation) {
          try {
            const lot = await findOrCreateLot(prop.id, info.pendingDesignation, propIsDemo);
            lotColMap[col] = lot.id;
          } catch (e) {
            sheetErrors++; stats._errors++;
            errorList.push(`Lot creation failed (${sheetName}/${info.pendingDesignation}): ${e.message}`);
            delete lotColMap[col];
          }
        }
      }

      if (Object.keys(lotColMap).length === 0 && Object.keys(expColMap).length === 0) {
        for (const hRow of [headerRow0, headerRow]) {
          for (let c = 0; c < hRow.length; c++) {
            const cat = detectCategory(hRow[c]);
            if (cat && cat !== 'internal_transfer') expColMap[c] = cat;
            else if (cat === 'internal_transfer') virColIdxs.push(c);
          }
        }
      }

      const pushTx = (rawTx) => {
        // Libellé français d'affichage (snapshot) associé à la clé stable.
        rawTx.category_label = labelOf(rawTx.category);
        // 6) Contrôle d'appartenance défensif: property_id et lot_id DOIVENT appartenir au propriétaire.
        if (!ownPropertyIds.has(rawTx.property_id)) {
          sheetIgnored++; stats._rows_ignored++; return;
        }
        if (rawTx.lot_id && !ownLotIds.has(rawTx.lot_id)) {
          sheetIgnored++; stats._rows_ignored++; return;
        }
        const key = txKey(rawTx);
        const existing = txIndex.get(key);
        if (existing) {
          updates.push({ id: existing.id, amount: rawTx.amount, note: rawTx.note || existing.note });
          sheetUpdated++;
        } else {
          creates.push(rawTx);
          txIndex.set(key, rawTx); // évite les doublons intra-import
          sheetCreated++;
        }
        sheetRows++;
      };

      for (let r = 2; r < data.length; r++) {
        const row = data[r];
        if (!row) continue;
        const my = getMonthYear(row[dateCol]);
        if (!my) { sheetIgnored++; stats._rows_ignored++; continue; }

        for (const [col, lotId] of Object.entries(lotColMap)) {
          if (typeof lotId !== 'string') continue;
          const val = numVal(row[parseInt(col)]);
          if (val === 0) continue;
          pushTx({
            owner_id: owner, is_demo: propIsDemo, property_id: prop.id, lot_id: lotId,
            year: my.year, month: my.month, category: 'rent', amount: Math.abs(val), type: 'income',
            note: ''
          });
        }

        for (const col of virColIdxs) {
          const val = numVal(row[col]);
          if (val === 0) continue;
          pushTx({
            owner_id: owner, is_demo: propIsDemo, property_id: prop.id,
            year: my.year, month: my.month, category: 'internal_transfer', amount: Math.abs(val), type: 'income',
            note: ''
          });
        }

        for (const [col, category] of Object.entries(expColMap)) {
          if (!category) continue;
          const val = numVal(row[parseInt(col)]);
          if (val === 0) continue;
          pushTx({
            owner_id: owner, is_demo: propIsDemo, property_id: prop.id,
            year: my.year, month: my.month, category, amount: -Math.abs(val), type: 'expense',
            note: ''
          });
        }
      }

      // 7) Persistance — bulkCreate / bulkUpdate par lots, avec gestion d'erreur et journalisation.
      const BATCH = 30;
      for (let i = 0; i < creates.length; i += BATCH) {
        const chunk = creates.slice(i, i + BATCH);
        try {
          await svc.entities.Transaction.bulkCreate(chunk);
        } catch (e) {
          sheetErrors++; stats._errors++;
          errorList.push(`bulkCreate ${sheetName} batch ${i}: ${e.message}`);
          await sleep(1500);
          try { await svc.entities.Transaction.bulkCreate(chunk); } catch (_) {}
        }
        await sleep(150);
      }
      for (let i = 0; i < updates.length; i += BATCH) {
        const chunk = updates.slice(i, i + BATCH);
        try {
          await svc.entities.Transaction.bulkUpdate(chunk.map(u => ({ id: u.id, amount: u.amount, note: u.note })));
        } catch (e) {
          sheetErrors++; stats._errors++;
          errorList.push(`bulkUpdate ${sheetName} batch ${i}: ${e.message}`);
          // repli unitaire
          for (const u of chunk) {
            try { await svc.entities.Transaction.update(u.id, { amount: u.amount, note: u.note }); }
            catch (_) { /* journalisé plus haut */ }
          }
        }
        await sleep(150);
      }

      stats._tx_created += sheetCreated;
      stats._tx_updated += sheetUpdated;
      stats._rows_ignored += 0; // déjà compté
      bySheet[sheetName] = {
        rows: sheetRows, tx_created: sheetCreated, tx_updated: sheetUpdated,
        rows_ignored: sheetIgnored, errors: sheetErrors
      };
    }

    // 8) Rapport d'import complet — AUCUNE donnée d'un autre propriétaire.
    return Response.json({
      success: true,
      owner,
      totals: {
        lots_created: stats._lots_created,
        transactions_created: stats._tx_created,
        transactions_updated: stats._tx_updated,
        rows_ignored: stats._rows_ignored,
        errors: stats._errors,
      },
      clear: clearReport.requested
        ? { scope: body.clear_period ? `period=${body.clear_period}` : 'all_owner', deleted: clearReport.deleted, logged: clearReport.log.length, sample_log: clearReport.log }
        : null,
      bySheet,
      unmatched_sheets: unmatchedSheets,
      errors_sample: errorList.slice(0, 50),
    });
  } catch (error) {
    console.error('Erreur:', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}