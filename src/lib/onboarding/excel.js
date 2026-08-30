// Moteur d'import Excel guidé : parsing, mapping, validation, dédoublonnage.
import * as XLSX from 'xlsx';
import { ENTITY_FIELDS } from './fieldMaps';

const norm = (s) => String(s ?? '').trim();

function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toDate(v) {
  if (!v && v !== 0) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let d = new Date(s);
  if (isNaN(d.getTime())) {
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      d = new Date(`${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    }
  }
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toBool(v) {
  if (v == null || v === '') return null;
  const s = String(v).toLowerCase();
  if (['true', 'oui', 'o', '1', 'x', 'oui'].includes(s)) return true;
  if (['false', 'non', 'n', '0', ''].includes(s)) return false;
  return null;
}

function coerce(value, field) {
  if (value == null || value === '') return field.default ?? null;
  if (field.type === 'number') return toNum(value);
  if (field.type === 'date') return toDate(value);
  if (field.type === 'boolean') return toBool(value);
  if (field.type === 'enum') {
    const raw = norm(value);
    const found = field.enum.find((e) => e.toLowerCase() === raw.toLowerCase());
    return found || field.default || raw;
  }
  return norm(value);
}

// Devine une colonne source pour un champ à partir des en-têtes.
function guessColumn(headers, field) {
  const targets = [field.label, field.key.replace(/__/g, ''), ...(field.enum || [])].map((s) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  );
  const scored = headers
    .map((h) => {
      const hh = h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      let best = 0;
      for (const t of targets) {
        if (hh === t) best = Math.max(best, 100);
        else if (hh.includes(t)) best = Math.max(best, 60 + t.length / hh.length);
        else if (t.includes(hh) && hh.length > 2) best = Math.max(best, 40);
      }
      return { header: h, score: best };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 40 ? scored[0].header : null;
}

export function autoMapping(headers, entityType) {
  const def = ENTITY_FIELDS[entityType];
  const mapping = { links: {}, fields: {} };
  for (const l of def.links) mapping.links[l.key] = guessColumn(headers, { label: l.label, key: l.key });
  for (const f of def.fields) mapping.fields[f.key] = guessColumn(headers, f);
  return mapping;
}

// Parse un fichier Excel ou CSV -> { headers, rows }
export async function parseSheet(file) {
  const isCsv = /\.csv$/i.test(file.name);
  let ws;
  if (isCsv) {
    const text = await file.text();
    const wb = XLSX.read(text, { type: 'string', cellDates: true });
    ws = wb.Sheets[wb.SheetNames[0]];
  } else {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array', cellDates: true });
    ws = wb.Sheets[wb.SheetNames[0]];
  }
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

function resolveLink(link, rawValue, ctx) {
  if (!rawValue) return null;
  const pool = link.from === 'property' ? ctx.properties : ctx.lots;
  const key = link.match;
  const found = pool.find((p) => norm(p[key]).toLowerCase() === norm(rawValue).toLowerCase());
  return found?.id || null;
}

// Construit les enregistrements validés à partir du mapping.
export function buildRecords(entityType, rows, mapping, ctx) {
  const def = ENTITY_FIELDS[entityType];
  const existingPrints = new Set();
  // Empreintes des enregistrements existants pour le dédoublonnage.
  const list = entityType === 'property' ? ctx.properties : entityType === 'lot' ? ctx.lots : ctx.leases;
  (list || []).forEach((r) => {
    try { existingPrints.add(def.dedup(r)); } catch { /* skip */ }
  });

  const seen = new Set();
  return rows.map((row) => {
    const rec = {};
    const errors = [];
    const warnings = [];

    // Liens
    for (const l of def.links) {
      const col = mapping.links[l.key];
      const raw = col ? row[col] : null;
      let id = null;
      if (raw) id = resolveLink(l, raw, ctx);
      if (!id && l.required) errors.push({ field: l.key, message: `${l.label} introuvable` });
      // Pour les liens scopés (lot par propriété), on a besoin de property_id d'abord.
      ctx = l.scopeBy ? { ...ctx, _scopePropertyId: rec.property_id } : ctx;
      if (l.scopeBy && id) {
        // re-résolution scopée si on vient de trouver property_id
        if (l.key === 'lot_id' && rec.property_id) {
          const lot = ctx.lots.find(
            (x) => x.property_id === rec.property_id && norm(x.designation).toLowerCase() === norm(raw).toLowerCase()
          );
          id = lot?.id || id;
        }
      }
      rec[l.key] = id;
    }

    // Champs
    const tenant = {};
    for (const f of def.fields) {
      const col = mapping.fields[f.key];
      const raw = col ? row[col] : null;
      let val = coerce(raw, f);
      if (val == null && f.required && !f.default) {
        errors.push({ field: f.key, message: `${f.label} manquant` });
      } else if (val == null && f.required && f.default) {
        val = f.default;
      }
      if (f.type === 'enum' && val && f.enum && !f.enum.includes(val) && !f.default) {
        warnings.push({ field: f.key, message: `${f.label}: « ${val} » non reconnu` });
      }
      if (f.type === 'number' && raw != null && raw !== '' && val == null) {
        errors.push({ field: f.key, message: `${f.label}: montant invalide` });
      }
      if (f.type === 'date' && raw && raw !== '' && val == null) {
        errors.push({ field: f.key, message: `${f.label}: date invalide` });
      }
      if (f.special === 'tenant') {
        const tkey = f.key.replace('__', '');
        if (val != null) tenant[tkey] = val;
      } else {
        rec[f.key] = val;
      }
    }

    // Statut de bail
    if (entityType === 'lease') {
      rec.status = 'actif';
      if (rec.date_end && toDate(rec.date_end) < new Date().toISOString().slice(0, 10)) rec.status = 'termine';
      if (Object.keys(tenant).length) {
        rec.tenants = [{ name: tenant.name || 'Locataire', email: tenant.email, phone: tenant.phone, entry_date: tenant.entry }];
      }
      if (!rec.tenants || !rec.tenants.length) delete rec.tenants;
    }

    // Dédoublonnage
    let duplicate = false;
    try {
      const fp = def.dedup(rec);
      if (existingPrints.has(fp) || seen.has(fp)) duplicate = true;
      else seen.add(fp);
    } catch { /* skip */ }

    const status = errors.length ? 'error' : duplicate ? 'duplicate' : 'ok';
    return { rec, status, errors, warnings, duplicate };
  });
}

export const STATUS_META = {
  ok: { label: 'Prêt', cls: 'text-emerald-600 bg-emerald-50' },
  duplicate: { label: 'Doublon', cls: 'text-amber-600 bg-amber-50' },
  error: { label: 'Invalide', cls: 'text-red-600 bg-red-50' },
};