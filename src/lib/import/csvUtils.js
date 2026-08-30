/**
 * Module CSV canonique de Patrimo — SRCI unique de parsing (RFC 4180).
 *
 * REMPLACE tout parsing artisanal basé sur split(';') / split(',') par une
 * machine à états robuste qui gère :
 *   - séparateurs ';' et ',' + détection automatique ;
 *   - guillemets ("") et séparateurs présents à l'intérieur des guillemets ;
 *   - retours à la ligne à l'intérieur d'un champ guillemeté ;
 *   - BOM UTF-8 ;
 *   - colonnes vides et lignes vides (non perdues silencieusement) ;
 *   - grands fichiers (machine en O(n), sans regex sur tout le texte) ;
 *   - fichiers bancaires français (espaces fines, ',' décimale, notation « 42,30- »).
 *
 * Validateurs stricts (jamais de 0 silencieux pour une entrée invalide) :
 *   - parseFrenchNumber()    → { ok, value, error }  (montant FR)
 *   - normalizeAmount()       → number | null        (null = invalide)
 *   - parseAndValidateDate()  → { ok, value:'YYYY-MM-DD', day, month, year, error }
 *
 * Rapport d'import (meta) : lignes lues / valides / rejetées + erreur par ligne +
 * avertissements. Aucune ligne n'est tronquée ou perdue silencieusement.
 *
 * Compatibilité : parseCsvTable() / toNumber() / parseDate() / findField() /
 * isCafText() / guessMonthYear() / matchTenantLot() restent exportés comme
 * façades (et délèquent désormais au cœur robuste).
 */

const BOM = '\uFEFF';

/* ----------------------------- Séparateur ----------------------------- */

/**
 * Détecte le séparateur (';' ou ',') en comptant les occurrences hors
 * guillemets sur un échantillon. En cas d'égalité, ';' (usage bancaire FR).
 * @param {string} text
 * @returns {','|';'}
 */
export function detectSeparator(text) {
  if (!text) return ';';
  let s = String(text);
  if (s[0] === BOM) s = s.slice(1);
  const sample = s.slice(0, 8192);
  let sc = 0;
  let cc = 0;
  let inQ = false;
  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i];
    if (inQ) {
      if (ch === '"') {
        if (sample[i + 1] === '"') i++;
        else inQ = false;
      }
      continue;
    }
    if (ch === '"') { inQ = true; continue; }
    if (ch === ';') sc++;
    else if (ch === ',') cc++;
  }
  if (sc === 0 && cc === 0) return ';';
  return sc >= cc ? ';' : ',';
}

/* ------------------------- Machine à états RFC 4180 ------------------------- */

/**
 * Parse un texte CSV selon RFC 4180.
 *
 * @param {string} text
 * @param {{ delimiter?: string, hasHeader?: boolean }} [options]
 * @returns {{
 *   delimiter: string,
 *   headers: string[],
 *   rawRows: string[][],
 *   rows: Record<string,string>[],
 *   meta: { total: number, valid: number, rejected: number, errors: Array<{row:number,line:number,message:string}>, warnings: Array<{row:number,line:number,message:string}> },
 * }}
 */
export function parseCsv(text, options = {}) {
  let src = text == null ? '' : String(text);
  if (src[0] === BOM) src = src.slice(1);
  // CRLF -> LF, CR isolé -> LF (les newlines dans champs guillemetés sont gérés).
  src = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const delimiter = options.delimiter || detectSeparator(src);
  const hasHeader = options.hasHeader !== false;

  const records = []; // { values: string[], line: number, error?: string }
  let field = '';
  let fields = [];
  let inQuotes = false;
  let fieldStart = true;
  let recordStarted = false;
  let line = 1;
  let i = 0;
  const n = src.length;
  const blanks = []; // numéros de lignes vides (pour avertissement)

  const flushField = () => { fields.push(field); field = ''; fieldStart = true; };
  const flushRecord = (hadError) => {
    records.push({ values: fields, line, error: hadError ? 'guillemet non fermé' : null });
    fields = []; field = ''; fieldStart = true; inQuotes = false; recordStarted = false;
  };

  while (i < n) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (fieldStart && ch === '"') { inQuotes = true; fieldStart = false; i++; continue; }
    if (ch === delimiter) { flushField(); recordStarted = true; i++; continue; }
    if (ch === '\n') {
      // fin d'enregistrement (sauf ligne totalement vide)
      if (fields.length > 0 || field !== '' || recordStarted) {
        flushField(); flushRecord(false);
      } else {
        blanks.push(line); // ligne vide → avertie (non perdue silencieusement)
      }
      line++; i++; continue;
    }
    // quote en milieu de champ non guillemeté → on l'ajoute (tolérance bancale)
    if (ch === '"') { field += ch; i++; continue; }
    field += ch; fieldStart = false; recordStarted = true; i++;
  }
  // flush dernier enregistrement (fichier sans LF final)
  if (inQuotes) {
    flushField(); flushRecord(true); // guillemet non fermé
  } else if (fields.length > 0 || field !== '' || recordStarted) {
    flushField(); flushRecord(false);
  }

  // -- En-têtes --
  const errors = [];
  const warnings = [];
  let headers = [];
  if (hasHeader) {
    const headerRec = records.shift();
    if (headerRec) {
      headers = headerRec.values.map((h) => h.trim());
      if (headerRec.error) warnings.push({ row: 0, line: headerRec.line, message: headerRec.error });
    }
  }
  const expectedCols = headers.length;

  // -- Filtrage des lignes vides + construction des sorties --
  const rawRows = [];
  const rows = [];
  let rowIndex = 0;
  for (const rec of records) {
    rowIndex++;
    // ligne vide (un seul champ vide) -> avertissement, non comptée comme data
    if (rec.values.length === 1 && rec.values[0].trim() === '' && !rec.error) {
      warnings.push({ row: rowIndex, line: rec.line, message: 'ligne vide ignorée' });
      continue;
    }
    if (rec.error) {
      errors.push({ row: rowIndex, line: rec.line, message: rec.error });
      // on conserve quand même les valeurs (pas de perte silencieuse)
    }
    let values = rec.values;
    if (expectedCols > 0) {
      if (values.length < expectedCols) {
        const pad = expectedCols - values.length;
        values = values.concat(Array(pad).fill(''));
        warnings.push({ row: rowIndex, line: rec.line, message: `${values.length - pad} colonne(s) attendue(s), ${values.length - pad} trouvée(s) — colonnes vides ajoutées` });
      } else if (values.length > expectedCols) {
        warnings.push({ row: rowIndex, line: rec.line, message: `${expectedCols} colonnes attendues, ${values.length} trouvées — valeurs excédentaires conservées dans __extra` });
      }
    }
    rawRows.push(values);
    // objet clé→valeur (index-safe pour en-têtes vides / dupliqués)
    const obj = {};
    headers.forEach((h, idx) => {
      const key = h && !(h in obj) ? h : `__col_${idx}`;
      obj[key] = values[idx] ?? '';
      obj[`__col_${idx}`] = values[idx] ?? '';
    });
    if (values.length > expectedCols) {
      obj.__extra = values.slice(expectedCols).join(delimiter);
    }
    rows.push(obj);
  }

  const rejected = errors.length;
  const valid = rawRows.length - rejected;
  const blankWarnings = blanks.map((b) => ({ row: 0, line: b, message: 'ligne vide ignorée' }));
  return {
    delimiter,
    headers,
    rawRows,
    rows,
    meta: {
      total: rawRows.length,
      valid,
      rejected,
      errors,
      warnings: blankWarnings.concat(warnings),
    },
  };
}

/** Façade de compatibilité : { headers, rows } (ancien contrat). */
export function parseCsvTable(text, options = {}) {
  const r = parseCsv(text, options);
  return { headers: r.headers, rows: r.rows };
}

/* ----------------------------- Montants FR ----------------------------- */

/**
 * Parse un montant français strictement. Ne renvoie JAMAIS 0 pour une entrée
 * invalide : { ok:false, value:null, error }.
 *
 * Accepte : "1 234,56", "1234,56", "1234.56", "1.234,56 €", "-42,30",
 *           "42,30-" (notation FR), "(123,45)" (compta), "+1 200,00".
 * Règle : ',' présente → décimale ; '.' = milliers (retiré).
 *         ',' absente → '.' = décimale (ISO).
 */
export function parseFrenchNumber(input) {
  if (input == null) return { ok: false, value: null, error: 'montant manquant' };
  let s = String(input).trim();
  if (s === '') return { ok: false, value: null, error: 'montant vide' };

  // retire d'éventuels guillemets CSV englobants ("1.234,56 €")
  s = s.replace(/^"([\s\S]*)"$/, '$1').replace(/""/g, '"').trim();
  if (s === '') return { ok: false, value: null, error: 'montant vide' };

  let negative = false;
  const par = s.match(/^\((.+)\)$/);
  if (par) { negative = true; s = par[1].trim(); }
  if (s.startsWith('-')) { negative = true; s = s.slice(1).trim(); }
  else if (s.startsWith('+')) { s = s.slice(1).trim(); }
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1).trim(); }

  // retire espaces (dont insécables/fines), €, EUR
  s = s.replace(/[\s\u00A0\u202F\u2009]/g, '').replace(/€/g, '').replace(/EUR/gi, '').trim();
  if (s === '') return { ok: false, value: null, error: 'montant vide' };

  let normalized;
  if (s.includes(',')) {
    // ',' = décimale ; '.' = séparateur de milliers (retiré)
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else {
    // '.' = décimale (ISO/Anglo). Pas de milliers sans virgule ici.
    normalized = s;
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return { ok: false, value: null, error: `montant invalide : « ${String(input).trim()} »` };
  }
  let v = parseFloat(normalized);
  if (!isFinite(v)) return { ok: false, value: null, error: 'montant non numérique' };
  if (negative) v = -v;
  return { ok: true, value: v };
}

/**
 * Normalise un montant → number, ou null si invalide (jamais 0 silencieux).
 * 0 est une valeur valide (« 0,00 »).
 */
export function normalizeAmount(input) {
  const r = parseFrenchNumber(input);
  return r.ok ? r.value : null;
}

/** Façade legacy : renvoie 0 pour invalide (compatibilité import pipeline). */
export function toNumber(input) {
  const r = parseFrenchNumber(input);
  return r.ok ? r.value : 0;
}

/* ------------------------------- Dates ------------------------------- */

function daysInMonth(y, m) {
  if (m < 1 || m > 12) return 0;
  return [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

function validYMD(y, m, d) {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/**
 * Valide strictement une date. Accepte dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy,
 * yyyy-mm-dd, yyyy/mm/dd. Rejette les dates calendaires invalides
 * (31/02/2026) et les formats non reconnus (13/2026). Pas de 0 silencieux.
 * @returns {{ ok: boolean, value: string|null, day?: number, month?: number, year?: number, error?: string }}
 */
export function parseAndValidateDate(input) {
  if (input == null) return { ok: false, value: null, error: 'date manquante' };
  const raw = String(input).trim().replace(/\./g, '/').replace(/-/g, '/');
  if (raw === '') return { ok: false, value: null, error: 'date vide' };

  let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = +m[1];
    const mo = +m[2];
    const y = +m[3];
    if (!validYMD(y, mo, d)) return { ok: false, value: null, error: `date invalide : « ${raw} »` };
    return { ok: true, value: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, day: d, month: mo, year: y };
  }
  m = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    if (!validYMD(y, mo, d)) return { ok: false, value: null, error: `date invalide : « ${raw} »` };
    return { ok: true, value: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, day: d, month: mo, year: y };
  }
  return { ok: false, value: null, error: `format de date non reconnu : « ${raw} »` };
}

/** Façade legacy : { day, month, year } | null sur date invalide/non reconnue. */
export function parseDate(input) {
  const r = parseAndValidateDate(input);
  if (!r.ok) return null;
  return { day: r.day, month: r.month, year: r.year };
}

/* ------------------------------- Domaine ------------------------------- */

/** Indice d'un en-tête par mots-clés (insensible à la casse). */
export function findField(headers, keywords) {
  return headers.findIndex((h) => keywords.some((k) => (h || '').toLowerCase().includes(k)));
}

/** Détecte un fichier de type CAF (allocataires / prestations). */
export function isCafText(text) {
  const l = (text || '').toLowerCase();
  return l.includes('allocataire') || l.includes('caf') || l.includes('prestations') || l.includes('bénéficiaire');
}

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Devine { month, year } depuis une période ou une date (MM/YYYY, « janvier 2024 », date). */
export function guessMonthYear(period, importDate) {
  if (!period && !importDate) return { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
  const src = (period || importDate || '').toLowerCase();
  for (let i = 0; i < 12; i++) {
    if (src.includes(MONTH_NAMES[i])) {
      const ym = src.match(/(\d{4})/);
      return { month: i + 1, year: ym ? +ym[1] : new Date().getFullYear() };
    }
  }
  let m1 = src.match(/(\d{1,2})[/\-](\d{4})/);
  if (m1) {
    const month = +m1[1];
    if (month >= 1 && month <= 12) return { month, year: +m1[2] };
  }
  let m2 = src.match(/(\d{4})[/\-](\d{1,2})/);
  if (m2) {
    const month = +m2[2];
    if (month >= 1 && month <= 12) return { month, year: +m2[1] };
  }
  const p = parseDate(period || importDate);
  if (p) return { month: p.month, year: p.year };
  return { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
}

/** Rapproche une description à un lot via le nom du locataire. */
export function matchTenantLot(text, lots) {
  const desc = (text || '').toLowerCase();
  if (!desc) return null;
  for (const lot of lots) {
    if (!lot.tenant_name) continue;
    const parts = lot.tenant_name.toLowerCase().split(/\s+/).filter((n) => n.length > 2);
    if (parts.some((n) => desc.includes(n))) return lot;
  }
  return null;
}