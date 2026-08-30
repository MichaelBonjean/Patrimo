/**
 * Moteur du pipeline d'import unifié :
 *
 *   File/Input → Parser → Normalizer → Matching → Rules → AI fallback
 *             → Human Review → Commit → Audit log
 *
 * Chaque ligne porte un `row_id` stable pendant tout le processus : l'IA reçoit
 * et renvoie ce row_id, ce qui empêche tout réordonnancement de mélanger
 * montants/descriptions. Les montants et dates proviennent toujours du parser
 * déterministe (source de confiance), jamais de l'IA.
 *
 * Statuts d'aperçu (canoniques) :
 *   imported | categorized | to_verify | duplicate | rejected
 */

import { parseCsvTable, findField, toNumber, isCafText, parseDate, guessMonthYear, matchTenantLot } from './csvUtils';
import { resolveKey, labelOf, TRANSACTION_CATEGORIES } from '@/lib/financeCategories';
import { aiExtractBankPdf } from './aiCategorize';
import { makeFingerprint, normalizeDescription, classifyDuplicate } from './fingerprint';

export const STATUS = {
  IMPORTED: 'imported',
  CATEGORIZED: 'categorized',
  TO_VERIFY: 'to_verify',
  DUPLICATE: 'duplicate',
  REJECTED: 'rejected',
};

export const STATUS_LABELS = {
  imported: 'Importé',
  categorized: 'Catégorisé',
  to_verify: 'À vérifier',
  duplicate: 'Doublon',
  rejected: 'Rejeté',
};

let idCounter = 0;
const nextId = () => `row-${++idCounter}`;

function blankRow(sourceType) {
  return {
    row_id: nextId(),
    source_type: sourceType,
    raw_date: '',
    description: '',
    amount: 0,
    account: '',
    note: '',
    bank_category: '',
    property_id: '',
    lot_id: '',
    category: '',
    type: 'income',
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    include: true,
    status: STATUS.IMPORTED,
    confidence: null,
    reason: '',
    fingerprint: '',
    normalized_description: '',
    duplicate_level: null,
    duplicate_of: '',
    provider_transaction_id: '',
  };
}

/* ----------------------------- Parsers ----------------------------- */

export function parseBankRows(text) {
  const { headers, rows } = parseCsvTable(text);
  const di = findField(headers, ['date']);
  const desci = findField(headers, ['description', 'libellé', 'libelle', 'opération', 'operation', 'intitulé']);
  const cati = findField(headers, ['catégorie', 'categorie', 'type']);
  const amti = findField(headers, ['montant', 'amount', 'débit', 'crédit', 'valeur']);
  const acci = findField(headers, ['compte', 'account']);
  const notei = findField(headers, ['note']);
  const get = (row, idx) => (idx >= 0 ? row[headers[idx]] || '' : '');
  const out = [];
  rows.forEach((row) => {
    const amount = toNumber(get(row, amti));
    if (amount === 0) return;
    const r = blankRow('bank');
    r.raw_date = get(row, di);
    r.description = get(row, desci);
    r.bank_category = get(row, cati);
    r.amount = amount;
    r.account = get(row, acci);
    r.note = get(row, notei);
    r.type = amount >= 0 ? 'income' : 'expense';
    out.push(r);
  });
  return out;
}

export function parseCafRows(text) {
  const { headers, rows } = parseCsvTable(text);
  const di = findField(headers, ['date']);
  const amti = findField(headers, ['montant', 'amount']);
  const beni = findField(headers, ['bénéficiaire', 'beneficiaire', 'allocataire', 'nom', 'prestation', 'libellé']);
  const peri = findField(headers, ['période', 'periode', 'mois']);
  const get = (row, idx) => (idx >= 0 ? row[headers[idx]] || '' : '');
  const out = [];
  rows.forEach((row) => {
    const amount = toNumber(get(row, amti));
    if (amount <= 0) return;
    const r = blankRow('caf');
    r.raw_date = get(row, di);
    r.description = `CAF – ${get(row, beni)}`;
    r.bank_category = 'CAF';
    r.amount = amount;
    r.account = '';
    r.period = get(row, peri);
    r.type = 'income';
    const my = guessMonthYear(r.period, r.raw_date);
    r.month = my.month; r.year = my.year;
    out.push(r);
  });
  return out;
}

const MONTH_MAP = {
  jan: 1, 'fév': 2, fev: 2, mar: 3, avr: 4, avril: 4, mai: 5, jun: 6, juin: 6,
  jui: 7, juil: 7, 'jui.': 7, 'juil.': 7, 'aoû': 8, aou: 8, août: 8, aout: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, 'déc': 12, dec: 12, 'dec.': 12, 'déc.': 12,
};

function parseMonthYearExcel(str) {
  if (!str) return null;
  const m = String(str).toLowerCase().match(/([a-zéôûî]+)[-\s.]?(\d{2,4})/);
  if (!m) return null;
  const month = MONTH_MAP[m[1].replace(/[.\s]/g, '')];
  if (!month) return null;
  const year = m[2].length === 2 ? 2000 + parseInt(m[2], 10) : parseInt(m[2], 10);
  return { month, year };
}

/**
 * Parse un classeur « tableau financier » : première feuille, colonne Mois +
 * autres colonnes = catégories (libellés français mappés vers clés canoniques).
 */
export async function parseExcelRows(file) {
  const XLSX = await import('xlsx');
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  if (aoa.length < 2) return [];
  const headers = (aoa[0] || []).map((h) => String(h ?? '').trim());
  const monthIdx = headers.findIndex((h) => h.toLowerCase() === 'mois' || /mois|période|periode/.test(h.toLowerCase()));
  const out = [];
  for (let i = 1; i < aoa.length; i++) {
    const cells = aoa[i] || [];
    const monthStr = monthIdx >= 0 ? cells[monthIdx] : '';
    const my = parseMonthYearExcel(monthStr) || { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
    headers.forEach((h, idx) => {
      if (idx === monthIdx || !h) return;
      const val = cells[idx];
      if (val === '' || val === '-' || val === '0') return;
      const num = toNumber(String(val));
      if (!num || isNaN(num)) return;
      const r = blankRow('excel');
      r.raw_date = '';
      r.description = `Excel – ${h}`;
      r.amount = Math.abs(num);
      r.bank_category = h;
      r.category = resolveKey(h) || '';
      r.type = num >= 0 ? 'income' : 'expense';
      r.month = my.month;
      r.year = my.year;
      r.note = `Import Excel – ${h}`;
      out.push(r);
    });
  }
  return out;
}

export function normalizeManual(record) {
  const r = blankRow('manual');
  const d = new Date(record.date);
  r.raw_date = record.date;
  r.description = record.description || '';
  r.amount = Math.abs(Number(record.amount) || 0);
  r.type = record.type || (record.amount >= 0 ? 'income' : 'expense');
  r.category = resolveKey(record.category) || record.category || '';
  r.property_id = record.property_id || '';
  r.lot_id = record.lot_id || '';
  r.month = d.getMonth() + 1;
  r.year = d.getFullYear();
  r.note = record.description || '';
  return r;
}

/* --------------------------- Deterministic --------------------------- */

/**
 * Applique les règles déterministes (BankRule par priorité + correspondance
 * locataire/lot) AVANT toute IA. Une ligne pleinement catégorisée passe en
 * `categorized`, sinon reste `imported`.
 */
export function applyDeterministic(rows, ctx) {
  const rules = (ctx.rules || []).filter((r) => r.is_active !== false).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  for (const r of rows) {
    if (r.source_type === 'manual' && r.category) { r.status = STATUS.CATEGORIZED; continue; }
    if (r.category && r.property_id) { r.status = STATUS.CATEGORIZED; continue; }
    const desc = (r.description || '').toLowerCase();
    const matched = rules.find((rule) => rule.keyword && desc.includes(rule.keyword.toLowerCase()));
    if (matched) {
      r.category = resolveKey(matched.assigned_category) || matched.assigned_category;
      r.property_id = matched.assigned_property_id || '';
      r.lot_id = matched.assigned_lot_id || '';
      r.reason = `Règle « ${matched.keyword} »`;
    }
    if ((!r.category || r.category === 'other') && ctx.lots?.length) {
      const lot = matchTenantLot(r.description || r.bank_category, ctx.lots);
      if (lot) {
        r.lot_id = lot.id;
        r.property_id = lot.property_id;
        r.category = 'rent';
        r.reason = 'Locataire reconnu';
      }
    }
    const d = parseDate(r.raw_date);
    if (d) { r.month = d.month; r.year = d.year; }
    r.status = (r.category && r.property_id) ? STATUS.CATEGORIZED : STATUS.IMPORTED;
    if (!r.category && r.source_type === 'caf') { r.category = 'caf'; r.reason = 'CAF (par défaut)'; }
  }
  return rows;
}

/**
 * Normalise la date d'une ligne en ISO YYYY-MM-DD pour le fingerprint.
 */
function rowDate(r) {
  if (r.raw_date) return r.raw_date;
  return `${r.year}-${String(r.month).padStart(2, '0')}-01`;
}

/**
 * Dédoublonnage par fingerprint SHA-256 (3 niveaux : exact / probable / unique).
 *
 * RÈGLE ABSOLUE : deux lignes ne sont JAMAIS fusionnées parce qu'elles partagent
 * le même mois + catégorie + lot. Seule l'identité de la ligne bancaire brute
 * (compte + provider_id + date + montant + libellé normalisé) détermine un
 * doublon. Les doublons EXACTS ne sont pas recréés au réimport ; les PROBABLES
 * sont présentés à l'utilisateur pour validation (statut `to_verify`).
 *
 * @param {object[]} rows lignes du pipeline (champ fingerprint renseigné ici)
 * @param {object[]} bankTransactions BankTransaction déjà importées (base de référence)
 */
export async function detectDuplicates(rows, bankTransactions = []) {
  // 1. Calcul du fingerprint de chaque ligne (SHA-256 — async)
  for (const r of rows) {
    if (!r.fingerprint) {
      r.normalized_description = normalizeDescription(r.description || '');
      r.fingerprint = await makeFingerprint({
        account_id: r.account,
        provider_transaction_id: r.provider_transaction_id || '',
        date: rowDate(r),
        amount: r.amount,
        raw_description: r.description,
        normalized_description: r.normalized_description,
      });
    }
  }
  // 2. Doublons exacts dans le lot courant (même fichier importé deux fois en une passe)
  const seen = new Set();
  for (const r of rows) {
    if (r.status === STATUS.REJECTED) continue;
    if (seen.has(r.fingerprint)) {
      r.status = STATUS.DUPLICATE;
      r.duplicate_level = 'exact';
      r.reason = 'Doublon dans le lot';
      continue;
    }
    seen.add(r.fingerprint);
  }
  // 3. Rapprochement contre les BankTransaction existantes (réimport d'un fichier)
  for (const r of rows) {
    if (r.status === STATUS.REJECTED || r.status === STATUS.DUPLICATE) continue;
    const { level, match } = classifyDuplicate({
      fingerprint: r.fingerprint,
      account_id: r.account,
      provider_transaction_id: r.provider_transaction_id || '',
      date: rowDate(r),
      amount: r.amount,
      normalized_description: r.normalized_description,
    }, bankTransactions);
    if (level === 'exact') {
      r.status = STATUS.DUPLICATE;
      r.duplicate_level = 'exact';
      r.duplicate_of = match?.id || '';
      r.reason = 'Déjà importé (doublon exact)';
    } else if (level === 'probable') {
      r.duplicate_level = 'probable';
      r.duplicate_of = match?.id || '';
      r.reason = 'Doublon probable à valider';
      if (r.status !== STATUS.CATEGORIZED) r.status = STATUS.TO_VERIFY;
    }
  }
  return rows;
}

/* ------------------------------ Orchestre ------------------------------ */

/**
 * Exécute le pipeline déterministe (parse → normalize → rules → duplicate).
 * L'étape IA est distincte (aiCategorize) et se déclenche explicitement sur les
 * lignes restées `imported`, afin de maîtriser le coût en crédits.
 *
 * @param {object} args
 * @param {'bank'|'caf'|'excel'|'manual'|'document'} args.type
 * @param {File[]|[]} args.files
 * @param {object} [args.manualRecord]
 * @returns {Promise<{rows: object[]}>}
 */
export async function runPipeline({ type, files = [], manualRecord }, ctx) {
  idCounter = 0;
  let rows = [];

  if (type === 'manual' && manualRecord) {
    rows = [normalizeManual(manualRecord)];
  } else {
    for (const file of files) {
      const name = (file.name || '').toLowerCase();
      const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls') || file.name === 'excel';
      const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
      let text = '';
      if (!isXlsx && !isPdf) {
        try { text = await file.text(); } catch { text = ''; }
      }
      if (isPdf) {
        // Pas de parser déterministe : extraction IA, lignes en `to_verify`.
        const pdfRows = await aiExtractBankPdf(file, ctx);
        rows = rows.concat(pdfRows);
      } else if (isXlsx || type === 'excel') {
        rows = rows.concat(await parseExcelRows(file));
      } else if (type === 'caf' || isCafText(text)) {
        rows = rows.concat(parseCafRows(text));
      } else {
        rows = rows.concat(parseBankRows(text));
      }
    }
  }

  applyDeterministic(rows, ctx);
  await detectDuplicates(rows, ctx.bankTransactions || []);
  return { rows };
}

/**
 * Construit les objets Transaction à persister depuis les lignes validées
 * (catégorisées, à rejeter, etc.). Réutilise le contrat du commit unifié
 * (commitTransactions) qui crée la trace BankImport (audit log) + Transaction.
 */
export function rowsToTransactions(rows) {
  const txs = [];
  for (const r of rows) {
    if (!r.include || r.status === STATUS.REJECTED || r.status === STATUS.DUPLICATE) continue;
    if (!r.property_id || !r.category) continue;
    txs.push({
      property_id: r.property_id,
      lot_id: r.lot_id || undefined,
      year: r.year,
      month: r.month,
      category: r.category,
      category_label: labelOf(r.category),
      amount: Math.abs(r.amount),
      type: r.type,
      note: r.note || r.description,
      _bankImport: {
        import_date: r.raw_date || `${r.year}-${String(r.month).padStart(2, '0')}-01`,
        description: r.description,
        amount: r.type === 'income' ? Math.abs(r.amount) : -Math.abs(r.amount),
        bank_category: r.bank_category,
        bank_notes: r.note,
        account: r.account,
        status: 'categorized',
        assigned_property_id: r.property_id,
        assigned_lot_id: r.lot_id || '',
        assigned_category: r.category,
        batch_id: `unified-${Date.now()}`,
        fingerprint: r.fingerprint,
        normalized_description: r.normalized_description,
        provider_transaction_id: r.provider_transaction_id || '',
        raw_date: r.raw_date || `${r.year}-${String(r.month).padStart(2, '0')}-01`,
      },
    });
  }
  return txs;
}