// Shared zod validators with French error messages + French business checks.
import { z } from 'zod';

export const REQUIRED = 'Ce champ est obligatoire';

/* ---------- SIRET (14 digits, Luhn checksum) ---------- */
export function luhnValid(numStr) {
  const d = (numStr || '').replace(/\s/g, '');
  if (!/^\d{14}$/.test(d)) return false;
  let sum = 0; let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

/* ---------- IBAN (mod 97) ---------- */
export function ibanValid(iban) {
  const s = (iban || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{6,30}$/.test(s)) return false;
  const rearr = s.slice(4) + s.slice(0, 4);
  const expanded = rearr.replace(/[A-Z]/g, c => (c.charCodeAt(0) - 55).toString());
  let rem = 0;
  for (const ch of expanded) rem = (rem * 10 + (+ch || 0)) % 97;
  return rem === 1;
}

/* ---------- Reusable field schemas ---------- */
export const frPostal = z.string()
  .optional()
  .refine(v => !v || /^\d{5}$/.test(v), 'Code postal à 5 chiffres');

export const siretField = z.string()
  .optional()
  .refine(v => !v || luhnValid(v), 'SIRET invalide (14 chiffres, clé Luhn)');

export const ibanField = z.string()
  .optional()
  .refine(v => !v || ibanValid(v), 'IBAN invalide');

export const emailField = z.string()
  .optional()
  .refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Adresse e-mail invalide');

export const phoneField = z.string()
  .optional()
  .refine(
    v => !v || /^(?:(?:\+|00)33|0)\s*[1-9](?:[\s.-]*\d{2}){4}$/.test(v),
    'Numéro de téléphone invalide (format FR)'
  );

// Positive / null monetary amount
export const money = z.number()
  .nullable()
  .optional()
  .refine(v => v == null || v >= 0, 'Le montant doit être positif');

// Loan / insurance rate: 0–15 %
export const ratePercent = z.number()
  .nullable()
  .optional()
  .refine(v => v == null || (v >= 0 && v <= 15), 'Le taux doit être entre 0 et 15 %');

// Loan duration: 1–30 years
export const durationYears = z.number()
  .nullable()
  .optional()
  .refine(v => v == null || (v >= 1 && v <= 30), 'La durée doit être entre 1 et 30 ans');

// Ownership share: 0–100 with at most 2 decimals
export const sharePercent = z.number()
  .refine(
    v => typeof v === 'number' && v >= 0 && v <= 100 && Math.round(v * 100) === v * 100,
    'Part entre 0 et 100 % (2 décimales max)'
  );

export const monthField = z.number().int().min(1, 'Mois invalide').max(12, 'Mois invalide');
export const yearField = z.number().int().min(2000, 'Année invalide').max(2100, 'Année invalide');

/* ---------- Record helper (for import validation reuse) ---------- */
export function validateRecord(schema, data) {
  const r = schema.safeParse(data);
  return r.success
    ? { success: true, data: r.data, errors: null }
    : { success: false, data: null, errors: r.error.flatten().fieldErrors };
}