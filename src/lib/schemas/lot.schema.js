import { z } from 'zod';
import { money, emailField, phoneField } from '../validation/validators';

export const TYPOLOGIES = ["Studio", "T1", "T1bis", "T2", "T3", "T4", "T5", "T6+", "Maison", "Local commercial", "Bureau", "Parking", "Garage", "Box", "Cave", "Terrain", "T2 en Duplex", "T3 en Duplex", "T4 en Duplex"];
export const LEASE_TYPES = ["Vide-Nu", "Meublé", "Bail commercial", "Bail mobilité", "Bail étudiant", "Saisonnier-Airbnb", "Bail mixte", "Courte durée"];
export const DPE_GES = ["A", "B", "C", "D", "E", "F", "G"];

const optionalEnum = (list) => z.string().optional().refine(v => !v || list.includes(v), 'Valeur non valide');

export const lotSchema = z.object({
  property_id: z.string({ required_error: 'Le bien parent est obligatoire' }).min(1, 'Le bien parent est obligatoire'),
  designation: z.string({ required_error: 'La désignation est obligatoire' }).trim().min(1, 'La désignation est obligatoire'),
  code: z.string().optional(),
  floor: z.string().optional(),
  typology: optionalEnum(TYPOLOGIES),
  surface: money,
  lease_type: optionalEnum(LEASE_TYPES),
  rent_excluding_charges: money,
  charges: money,
  deposit: money,
  tenant_name: z.string().optional(),
  tenant_email: emailField,
  tenant_phone: phoneField,
  tenant_entry_date: z.string().optional(),
  tenant_exit_date: z.string().optional(),
  dpe_class: optionalEnum(DPE_GES),
  ges_class: optionalEnum(DPE_GES),
  dpe_date: z.string().optional(),
  energy_consumption: money,
  furnished: z.boolean().optional(),
  access_code: z.string().optional(),
  is_vacant: z.boolean().optional(),
  comment: z.string().optional(),
});

export default lotSchema;