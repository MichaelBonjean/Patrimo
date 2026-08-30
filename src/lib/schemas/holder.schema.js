import { z } from 'zod';
import { siretField, emailField, phoneField, money, sharePercent } from '../validation/validators';

export const HOLDER_TYPES = ["Personne physique", "SCI", "SCI familiale", "SARL", "SAS", "SCPI", "Indivision"];

const oneOf = (list, msg) => z.custom(val => list.includes(val), msg);

export const holderSchema = z.object({
  name: z.string({ required_error: 'Le nom du détenteur est obligatoire' })
    .trim().min(1, 'Le nom du détenteur est obligatoire'),
  type: oneOf(HOLDER_TYPES, 'Le type de détenteur est obligatoire'),
  siret: siretField,
  email: emailField,
  phone: phoneField,
  address: z.string().optional(),
  capital: money,
  notes: z.string().optional(),
  members: z.array(z.object({
    holder_id: z.string().min(1, 'Désignez un associé'),
    share_percent: sharePercent,
  })).optional(),
}).superRefine((data, ctx) => {
  // Structures must carry a SIRET.
  const isStructure = ["SCI", "SCI familiale", "SARL", "SAS", "SCPI"].includes(data.type);
  if (isStructure && !data.siret) {
    ctx.addIssue({ path: ['siret'], message: 'Le SIRET est obligatoire pour une structure' });
  }
});

export default holderSchema;