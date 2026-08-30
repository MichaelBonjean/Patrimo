// Définitions des champs par entité pour l'import Excel guidé.
// Chaque champ : { key, label, type, enum?, required, default?, help, kind? }
// kind 'link' : lien vers une autre entité (résolu par nom/désignation).

export const ENTITY_FIELDS = {
  property: {
    entity: 'Property',
    label: 'Biens',
    singular: 'bien',
    links: [],
    dedup: (r) => `name:${String(r.name || '').toLowerCase().trim()}`,
    fields: [
      { key: 'name', label: 'Nom du bien', type: 'text', required: true },
      { key: 'category', label: 'Catégorie', type: 'enum', enum: ['Maison', 'Appartement', 'Immeuble', 'Local commercial', 'Bureau', 'Parking', 'Garage', 'Terrain', 'SCPI'], default: 'Appartement' },
      { key: 'holding_structure', label: 'Structure de détention', type: 'enum', enum: ['En propre', 'SCI', 'SCI familiale', 'SARL', 'SAS', 'SCPI'], default: 'En propre' },
      { key: 'tax_regime', label: 'Régime fiscal', type: 'enum', enum: ['Résidence principale', 'Location nue (revenus fonciers)', 'Location nue (micro-foncier)', 'LMNP au micro-BIC', 'LMNP au réel', 'LMP', "SCI à l'IR", "SCI à l'IS", 'Pinel', 'Denormandie'], default: 'Location nue (revenus fonciers)' },
      { key: 'address', label: 'Adresse', type: 'text' },
      { key: 'postal_code', label: 'Code postal', type: 'text' },
      { key: 'city', label: 'Ville', type: 'text' },
      { key: 'total_surface', label: 'Surface (m²)', type: 'number' },
      { key: 'acquisition_date', label: "Date d'acquisition", type: 'date' },
      { key: 'purchase_price', label: "Prix d'achat", type: 'number' },
      { key: 'notary_fees', label: 'Frais de notaire', type: 'number' },
      { key: 'estimated_value', label: 'Valeur estimée', type: 'number' },
      { key: 'property_tax', label: 'Taxe foncière (annuelle)', type: 'number' },
      { key: 'pno_insurance', label: 'Assurance PNO (annuelle)', type: 'number' },
      { key: 'condo_fees', label: 'Charges copro (annuelles)', type: 'number' },
    ],
  },
  lot: {
    entity: 'Lot',
    label: 'Lots',
    singular: 'lot',
    links: [{ key: 'property_id', label: 'Bien (nom)', from: 'property', match: 'name', required: true }],
    dedup: (r) => `lot:${r.property_id}|${String(r.designation || '').toLowerCase().trim()}`,
    fields: [
      { key: 'designation', label: 'Désignation', type: 'text', required: true },
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'typology', label: 'Typologie', type: 'enum', enum: ['Studio', 'T1', 'T1bis', 'T2', 'T3', 'T4', 'T5', 'T6+', 'Maison', 'Local commercial', 'Bureau', 'Parking', 'Garage', 'Box', 'Cave', 'Terrain', 'T2 en Duplex', 'T3 en Duplex', 'T4 en Duplex'] },
      { key: 'surface', label: 'Surface (m²)', type: 'number' },
      { key: 'floor', label: 'Étage', type: 'text' },
      { key: 'rent_excluding_charges', label: 'Loyer HC', type: 'number' },
      { key: 'charges', label: 'Charges', type: 'number' },
      { key: 'deposit', label: 'Caution', type: 'number' },
      { key: 'is_vacant', label: 'Vacant', type: 'boolean' },
      { key: 'furnished', label: 'Meublé', type: 'boolean' },
      { key: 'dpe_class', label: 'Classe DPE', type: 'enum', enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
    ],
  },
  lease: {
    entity: 'Lease',
    label: 'Baux / Locataires',
    singular: 'bail',
    links: [
      { key: 'property_id', label: 'Bien (nom)', from: 'property', match: 'name', required: true },
      { key: 'lot_id', label: 'Lot (désignation)', from: 'lot', match: 'designation', scopeBy: 'property_id', required: true },
    ],
    dedup: (r) => `lease:${r.property_id}|${r.lot_id}|${r.date_start}`,
    fields: [
      { key: 'date_start', label: "Date d'effet du bail", type: 'date', required: true },
      { key: 'date_end', label: 'Date de fin', type: 'date' },
      { key: 'lease_type', label: 'Type de bail', type: 'enum', enum: ['Vide-Nu', 'Meublé', 'Bail commercial', 'Bail mobilité', 'Bail étudiant', 'Saisonnier-Airbnb', 'Bail mixte', 'Courte durée'], default: 'Vide-Nu' },
      { key: 'rent_excluding_charges', label: 'Loyer HC', type: 'number' },
      { key: 'charges', label: 'Charges', type: 'number' },
      { key: 'deposit', label: 'Caution', type: 'number' },
      { key: 'due_day', label: "Jour d'échéance", type: 'number', default: 5 },
      { key: 'indexation_type', label: 'Indexation', type: 'enum', enum: ['IRL', 'ILC', 'ILAT', 'aucune'], default: 'aucune' },
      { key: '__tenant_name', label: 'Nom du locataire', type: 'text', special: 'tenant' },
      { key: '__tenant_email', label: 'Email du locataire', type: 'text', special: 'tenant' },
      { key: '__tenant_phone', label: 'Téléphone du locataire', type: 'text', special: 'tenant' },
      { key: '__tenant_entry', label: "Entrée du locataire", type: 'date', special: 'tenant' },
    ],
  },
};

export const ENTITY_ORDER = ['property', 'lot', 'lease'];