import { z } from 'zod';
import { monthField, yearField } from '../validation/validators';

export const TRANSACTION_CATEGORIES = ["Loyer", "Charges locataire", "Caution", "CAF", "Virement interne", "Autres revenus", "Échéance prêt", "Assurance prêt", "Assurance habitation", "Électricité", "Eau", "Gaz", "Internet", "Frais SCI", "Copropriété", "Travaux", "Taxe foncière", "PNO", "Frais gestion", "Comptable", "Notaire", "Banque", "Autres charges", "Assurance loyers impayés", "Entretien", "Divers"];

/**
 * Validation schema for a transaction record — usable by the import wizard
 * (validate each mapped row before commit) via `validateRecord(transactionSchema, row)`.
 */
export const transactionSchema = z.object({
  property_id: z.string().min(1, 'Bien obligatoire'),
  lot_id: z.string().optional().nullable(),
  year: yearField,
  month: monthField,
  category: z.string().refine(v => TRANSACTION_CATEGORIES.includes(v), 'Catégorie inconnue'),
  amount: z.number().refine(v => typeof v === 'number' && isFinite(v), 'Montant invalide'),
  type: z.enum(['income', 'expense'], { message: 'Type invalide' }),
  note: z.string().optional().nullable(),
});

export default transactionSchema;