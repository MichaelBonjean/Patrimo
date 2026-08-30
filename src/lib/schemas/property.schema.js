import { z } from 'zod';
import { frPostal, siretField, money, ratePercent, durationYears } from '../validation/validators';

export const CATEGORIES = ["Maison", "Appartement", "Immeuble", "Local commercial", "Bureau", "Parking", "Garage", "Terrain", "SCPI"];
export const STRUCTURES = ["En propre", "SCI", "SCI familiale", "SARL", "SAS", "SCPI"];
export const REGIMES = ["Résidence principale", "Location nue (revenus fonciers)", "Location nue (micro-foncier)", "LMNP au micro-BIC", "LMNP au réel", "LMP", "SCI à l'IR", "SCI à l'IS", "Pinel", "Denormandie"];

const oneOf = (list, msg) => z.custom(val => list.includes(val), msg);

/**
 * Validation schema for the Property form (and entity payloads).
 * Numbers are null|number (form NumberInput converts blank -> null).
 */
export const propertySchema = z.object({
  name: z.string({ required_error: 'Le nom du bien est obligatoire' })
    .trim().min(1, 'Le nom du bien est obligatoire'),
  category: oneOf(CATEGORIES, 'La catégorie est obligatoire'),
  total_surface: money,
  address: z.string().optional(),
  postal_code: frPostal,
  city: z.string().optional(),
  holding_structure: oneOf(STRUCTURES, 'La structure de détention est obligatoire'),
  tax_regime: oneOf(REGIMES, 'Le régime fiscal est obligatoire'),
  sci_name: z.string().optional(),
  sci_siret: siretField,
  sci_capital: money,
  sci_creation_date: z.string().optional(),
  sci_bank: z.string().optional(),
  acquisition_date: z.string().optional(),
  purchase_price: money,
  notary_fees: money,
  agency_fees: money,
  initial_works: money,
  estimated_value: money,
  loan_amount: money,
  down_payment: money,
  loan_start_date: z.string().optional(),
  loan_duration_years: durationYears,
  loan_rate: ratePercent,
  loan_deferred_months: money,
  monthly_payment: money,
  monthly_insurance: money,
  remaining_capital: money,
  bank: z.string().optional(),
  property_tax: money,
  pno_insurance: money,
  condo_fees: money,
  management_fees: money,
  accountant_fees: money,
  other_annual_charges: money,
  notary_contact: z.string().optional(),
  manager_contact: z.string().optional(),
  syndic_contact: z.string().optional(),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  // Business rule: a monthly payment requires a loan duration.
  if (data.monthly_payment != null && (data.loan_duration_years == null || data.loan_duration_years <= 0)) {
    ctx.addIssue({ path: ['loan_duration_years'], message: 'Renseigner la durée du prêt (1–30 ans) si une mensualité est saisie' });
  }
});

export default propertySchema;