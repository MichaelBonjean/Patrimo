import { base44 } from '@/api/base44Client';
import { labelOf } from '@/lib/financeCategories';

/**
 * Crée un jeu de données de démonstration :
 * 3 biens (1 appart en propre + 1 immeuble en SCI + 1 maison RP),
 * 5 lots, 3 locataires actifs + 2 anciens, ~24 mois de transactions cohérentes.
 * Tous les enregistrements sont marqués is_demo = true.
 */
export async function seedDemoData(ownerEmail) {
  if (!ownerEmail) throw new Error('Utilisateur non authentifié');

  // Idempotence : on ne reseme pas si des données de démo existent déjà
  const existing = await base44.entities.Property.filter({ owner_id: ownerEmail, is_demo: true });
  if (existing.length > 0) return 0;

  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;

  // 24 derniers mois (du plus ancien au plus récent)
  const months = [];
  let y = curY, m = curM;
  for (let i = 0; i < 24; i++) {
    months.push({ year: y, month: m });
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  months.reverse();

  const mkTx = (propertyId, lotId, { year, month }, category, amount, type, note) => ({
    owner_id: ownerEmail,
    property_id: propertyId,
    lot_id: lotId,
    year,
    month,
    category,
    category_label: labelOf(category),
    amount: Math.abs(amount),
    type,
    note: note || '',
    is_demo: true,
  });

  // --- Détenteurs factices : 2 personnes physiques + SCI ---
  const thomas = await base44.entities.Holder.create({
    owner_id: ownerEmail,
    name: 'Thomas Mercier',
    type: 'Personne physique',
    email: 'thomas.mercier@email.fr',
    phone: '+33611223344',
    address: '5 chemin des Lilas, 26100 Romans-sur-Isère',
    is_demo: true,
  });

  const elodie = await base44.entities.Holder.create({
    owner_id: ownerEmail,
    name: 'Élodie Garnier',
    type: 'Personne physique',
    email: 'elodie.garnier@email.fr',
    phone: '+33699887766',
    address: '12 rue des Lilas, 69001 Lyon',
    is_demo: true,
  });

  const sci = await base44.entities.Holder.create({
    owner_id: ownerEmail,
    name: 'SCI Résidence des Pins',
    type: 'SCI',
    siret: '12345678900012',
    address: '8 avenue des Pins, 26000 Valence',
    email: 'contact@sci-respins.fr',
    members: [
      { holder_id: thomas.id, share_percent: 55 },
      { holder_id: elodie.id, share_percent: 45 },
    ],
    is_demo: true,
  });

  // --- 3 biens ---
  const appartement = await base44.entities.Property.create({
    owner_id: ownerEmail,
    name: 'Appartement Cœur de Ville',
    category: 'Appartement',
    address: '12 rue des Lilas',
    postal_code: '69001',
    city: 'Lyon',
    total_surface: 48,
    holding_structure: 'En propre',
    tax_regime: 'Location nue (revenus fonciers)',
    acquisition_date: '2021-03-15',
    purchase_price: 180000,
    notary_fees: 12800,
    agency_fees: 9000,
    initial_works: 8000,
    estimated_value: 220000,
    loan_amount: 120000,
    down_payment: 60000,
    loan_start_date: '2021-04-01',
    loan_duration_years: 20,
    loan_rate: 1.45,
    monthly_payment: 575,
    monthly_insurance: 30,
    remaining_capital: 98000,
    bank: 'Crédit Mutuel',
    property_tax: 980,
    pno_insurance: 180,
    is_demo: true,
  });

  const immeuble = await base44.entities.Property.create({
    owner_id: ownerEmail,
    name: 'Immeuble Résidence des Pins',
    category: 'Immeuble',
    address: '8 avenue des Pins',
    postal_code: '26000',
    city: 'Valence',
    total_surface: 220,
    holding_structure: 'SCI',
    tax_regime: "SCI à l'IS",
    sci_name: 'SCI Résidence des Pins',
    sci_siret: '12345678900012',
    sci_creation_date: '2019-06-01',
    acquisition_date: '2019-09-01',
    purchase_price: 360000,
    notary_fees: 25000,
    initial_works: 15000,
    estimated_value: 420000,
    loan_amount: 200000,
    down_payment: 160000,
    loan_start_date: '2019-10-01',
    loan_duration_years: 25,
    loan_rate: 1.8,
    monthly_payment: 840,
    monthly_insurance: 45,
    remaining_capital: 165000,
    bank: 'Banque Populaire',
    property_tax: 2100,
    pno_insurance: 320,
    condo_fees: 2400,
    accountant_fees: 900,
    is_demo: true,
  });

  const maison = await base44.entities.Property.create({
    owner_id: ownerEmail,
    name: 'Maison des Lilas',
    category: 'Maison',
    address: '5 chemin des Lilas',
    postal_code: '26100',
    city: 'Romans-sur-Isère',
    total_surface: 110,
    holding_structure: 'En propre',
    tax_regime: 'Résidence principale',
    acquisition_date: '2020-05-10',
    purchase_price: 245000,
    notary_fees: 17000,
    estimated_value: 280000,
    loan_amount: 180000,
    down_payment: 65000,
    loan_start_date: '2020-06-01',
    loan_duration_years: 25,
    loan_rate: 1.25,
    monthly_payment: 710,
    monthly_insurance: 36,
    remaining_capital: 152000,
    bank: 'Crédit Agricole',
    property_tax: 1750,
    pno_insurance: 250,
    is_demo: true,
  });

  // --- Répartitions des détenteurs sur les 3 biens ---
  const link = (propertyId, holderId, sharePercent, entryDate) =>
    base44.entities.PropertyHolder.create({
      owner_id: ownerEmail,
      property_id: propertyId,
      holder_id: holderId,
      share_percent: sharePercent,
      entry_date: entryDate,
      is_demo: true,
    });

  // Appartement Cœur de Ville : indivision Thomas 60% / Élodie 40%
  await link(appartement.id, thomas.id, 60, '2021-03-15');
  await link(appartement.id, elodie.id, 40, '2021-03-15');
  // Immeuble : détenu à 100% par la SCI (répartie 55% Thomas / 45% Élodie via les membres)
  await link(immeuble.id, sci.id, 100, '2019-09-01');
  // Maison des Lilas : indivision Thomas 70% / Élodie 30%
  await link(maison.id, thomas.id, 70, '2020-05-10');
  await link(maison.id, elodie.id, 30, '2020-05-10');

  // --- 5 lots ---
  const lotApt = await base44.entities.Lot.create({
    owner_id: ownerEmail,
    property_id: appartement.id,
    designation: 'Appartement T2',
    code: 'APT-1',
    floor: 'RDC',
    typology: 'T2',
    surface: 48,
    lease_type: 'Vide-Nu',
    rent_excluding_charges: 720,
    charges: 60,
    deposit: 720,
    is_vacant: false,
    dpe_class: 'D',
    ges_class: 'E',
    energy_consumption: 210,
    dpe_date: '2022-04-01',
    furnished: false,
    tenants: [{ id: crypto.randomUUID(), name: 'Marie Dubois', entry_date: '2023-09-01', email: 'marie.dubois@email.fr', phone: '+33612345678' }],
    previous_tenants: [{ name: 'Pierre Martin', entry_date: '2021-05-01', exit_date: '2023-08-31', rent: 690, email: 'pierre.martin@email.fr', phone: '+33698765432' }],
    is_demo: true,
  });

  const lotA = await base44.entities.Lot.create({
    owner_id: ownerEmail,
    property_id: immeuble.id,
    designation: 'Appartement T2 — Lot A',
    code: 'IMM-A',
    floor: '1',
    typology: 'T2',
    surface: 52,
    lease_type: 'Vide-Nu',
    rent_excluding_charges: 680,
    charges: 55,
    deposit: 680,
    is_vacant: false,
    dpe_class: 'C',
    ges_class: 'C',
    energy_consumption: 150,
    dpe_date: '2023-01-15',
    furnished: false,
    tenants: [{ id: crypto.randomUUID(), name: 'Sophie Laurent', entry_date: '2022-07-01', email: 'sophie.laurent@email.fr', phone: '+33623456789' }],
    is_demo: true,
  });

  const lotB = await base44.entities.Lot.create({
    owner_id: ownerEmail,
    property_id: immeuble.id,
    designation: 'Studio — Lot B',
    code: 'IMM-B',
    floor: '1',
    typology: 'Studio',
    surface: 22,
    lease_type: 'Meublé',
    rent_excluding_charges: 450,
    charges: 40,
    deposit: 450,
    is_vacant: false,
    dpe_class: 'D',
    ges_class: 'E',
    energy_consumption: 240,
    dpe_date: '2023-01-15',
    furnished: true,
    tenants: [{ id: crypto.randomUUID(), name: 'Karim Benali', entry_date: '2024-01-01', email: 'karim.benali@email.fr', phone: '+33634567890' }],
    is_demo: true,
  });

  await base44.entities.Lot.create({
    owner_id: ownerEmail,
    property_id: immeuble.id,
    designation: 'Appartement T3 — Lot C',
    code: 'IMM-C',
    floor: '2',
    typology: 'T3',
    surface: 68,
    is_vacant: true,
    dpe_class: 'E',
    ges_class: 'F',
    energy_consumption: 320,
    dpe_date: '2022-06-10',
    previous_tenants: [{ name: 'Claire Petit', entry_date: '2021-09-01', exit_date: '2024-08-31', rent: 780, email: 'claire.petit@email.fr', phone: '+33645678901' }],
    is_demo: true,
  });

  await base44.entities.Lot.create({
    owner_id: ownerEmail,
    property_id: maison.id,
    designation: 'Maison',
    typology: 'Maison',
    surface: 110,
    is_vacant: true,
    is_demo: true,
  });

  // --- Transactions (24 mois + charges annuelles + travaux) ---
  const txns = [];
  for (const mo of months) {
    txns.push(mkTx(appartement.id, lotApt.id, mo, 'rent', 720, 'income', 'Loyer Marie Dubois'));
    txns.push(mkTx(appartement.id, lotApt.id, mo, 'loan_installment', 575, 'expense', 'Mensualité Crédit Mutuel'));

    txns.push(mkTx(immeuble.id, lotA.id, mo, 'rent', 680, 'income', 'Loyer Sophie Laurent'));
    txns.push(mkTx(immeuble.id, lotB.id, mo, 'rent', 450, 'income', 'Loyer Karim Benali'));
    txns.push(mkTx(immeuble.id, undefined, mo, 'loan_installment', 840, 'expense', 'Mensualité Banque Populaire'));
    txns.push(mkTx(immeuble.id, undefined, mo, 'condo_fees', 200, 'expense', 'Charges de copropriété'));

    txns.push(mkTx(maison.id, undefined, mo, 'loan_installment', 710, 'expense', 'Mensualité Crédit Agricole'));
  }

  const yearly = (propId, lotId, category, amount, note) => {
    for (const yr of [curY, curY - 1]) {
      txns.push(mkTx(propId, lotId, { year: yr, month: 10 }, category, amount, 'expense', note));
    }
  };
  yearly(appartement.id, lotApt.id, 'property_tax', 980, 'Taxe foncière');
  yearly(appartement.id, lotApt.id, 'property_insurance', 180, 'Assurance PNO');
  yearly(immeuble.id, undefined, 'property_tax', 2100, 'Taxe foncière');
  yearly(immeuble.id, undefined, 'cfe', 450, 'CFE');
  yearly(immeuble.id, undefined, 'accounting_fees', 900, 'Frais comptable SCI');
  yearly(immeuble.id, undefined, 'sci_fees', 350, 'Frais SCI');
  yearly(maison.id, undefined, 'property_tax', 1750, 'Taxe foncière');
  yearly(maison.id, undefined, 'property_insurance', 250, 'PNO');
  yearly(maison.id, undefined, 'property_insurance', 220, 'Assurance habitation');

  txns.push(mkTx(appartement.id, lotApt.id, months[6], 'works', 1500, 'expense', 'Rénovation salle de bain'));
  txns.push(mkTx(immeuble.id, undefined, months[12], 'works', 3200, 'expense', 'Ravalement façade'));

  await base44.entities.Transaction.bulkCreate(txns);
  return txns.length;
}

/**
 * Supprime toutes les données marquées is_demo = true appartenant à l'utilisateur.
 */
export async function clearDemoData(ownerEmail) {
  if (!ownerEmail) throw new Error('Utilisateur non authentifié');
  const filter = { owner_id: ownerEmail, is_demo: true };
  // Ordre important : dépendances d'abord
  await base44.entities.Transaction.deleteMany(filter);
  await base44.entities.Lot.deleteMany(filter);
  await base44.entities.BankImport.deleteMany(filter);
  await base44.entities.PropertyHolder.deleteMany(filter);
  await base44.entities.Holder.deleteMany(filter);
  await base44.entities.Property.deleteMany(filter);
}