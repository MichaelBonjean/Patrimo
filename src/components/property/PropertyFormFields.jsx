import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormText, FormNumber, FormDate, FormSelect, FormTextarea } from '@/components/form/FormField';
import { CATEGORIES, STRUCTURES, REGIMES } from '@/lib/schemas/property.schema';

function SectionTitle({ children }) {
  return <h3 className="text-sm font-semibold mb-4 pb-2 border-b border-border">{children}</h3>;
}

export default function PropertyFormFields({ form }) {
  const { control, watch, setValue } = form;
  const holdingStructure = watch('holding_structure');
  const isSCI = holdingStructure?.startsWith('SCI') || holdingStructure === 'SARL' || holdingStructure === 'SAS';
  const [selectedSCI, setSelectedSCI] = useState(watch('sci_name') || '');

  const { data: sciTemplates = [] } = useQuery({
    queryKey: ['sci-templates'],
    queryFn: () => base44.entities.SCITemplate.list(),
  });

  useEffect(() => {
    if (selectedSCI && isSCI) {
      const sci = sciTemplates.find(s => s.sci_name === selectedSCI);
      if (sci) {
        setValue('sci_name', sci.sci_name);
        setValue('sci_siret', sci.sci_siret);
        setValue('sci_capital', sci.sci_capital);
        setValue('sci_creation_date', sci.sci_creation_date);
        setValue('sci_bank', sci.sci_bank);
      }
    }
  }, [selectedSCI, isSCI, sciTemplates, setValue]);

  return (
    <div className="space-y-8">
      {/* Identité */}
      <section>
        <SectionTitle>Identité du bien</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormText control={control} name="name" label="Nom du bien *" placeholder="Ex: Immeuble Rue de la Paix" />
          <FormSelect control={control} name="category" label="Catégorie *" options={CATEGORIES} />
          <FormNumber control={control} name="total_surface" label="Surface totale (m²)" placeholder="m²" />
          <FormText control={control} name="address" label="Adresse" />
          <FormText control={control} name="postal_code" label="Code postal" placeholder="75001" />
          <FormText control={control} name="city" label="Ville" />
        </div>
      </section>

      {/* Structure & Fiscalité */}
      <section>
        <SectionTitle>Structure &amp; Fiscalité</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormSelect control={control} name="holding_structure" label="Structure de détention *" options={STRUCTURES} />
          <FormSelect control={control} name="tax_regime" label="Régime fiscal *" options={REGIMES} />
        </div>
        {isSCI && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 p-4 bg-muted/50 rounded-lg">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Sélectionner une SCI</label>
              <Select value={selectedSCI} onValueChange={setSelectedSCI}>
                <SelectTrigger><SelectValue placeholder="Sélectionner une SCI" /></SelectTrigger>
                <SelectContent>
                  {sciTemplates.map(sci => <SelectItem key={sci.id} value={sci.sci_name}>{sci.sci_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {selectedSCI && (
              <>
                <FormText control={control} name="sci_name" label="Dénomination sociale" disabled />
                <FormText control={control} name="sci_siret" label="SIRET" disabled />
                <FormNumber control={control} name="sci_capital" label="Capital social" placeholder="€" disabled />
                <FormDate control={control} name="sci_creation_date" label="Date de création" disabled />
                <FormText control={control} name="sci_bank" label="Banque société" disabled />
              </>
            )}
          </div>
        )}
      </section>

      {/* Acquisition */}
      <section>
        <SectionTitle>Acquisition</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormDate control={control} name="acquisition_date" label="Date d'acquisition" />
          <FormNumber control={control} name="purchase_price" label="Prix d'achat" placeholder="€" />
          <FormNumber control={control} name="notary_fees" label="Frais de notaire" placeholder="€" />
          <FormNumber control={control} name="agency_fees" label="Frais d'agence" placeholder="€" />
          <FormNumber control={control} name="initial_works" label="Travaux initiaux" placeholder="€" />
          <FormNumber control={control} name="estimated_value" label="Valeur estimée actuelle" placeholder="€" />
        </div>
      </section>

      {/* Financement */}
      <section>
        <SectionTitle>Financement</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormNumber control={control} name="loan_amount" label="Montant emprunté" placeholder="€" />
          <FormNumber control={control} name="down_payment" label="Apport (down payment)" placeholder="€" />
          <FormDate control={control} name="loan_start_date" label="Date début prêt" />
          <FormNumber control={control} name="loan_duration_years" label="Durée (années)" hint="1 à 30 ans" />
          <FormNumber control={control} name="loan_rate" label="Taux annuel (%)" placeholder="%" hint="0 à 15 %" />
          <FormNumber control={control} name="loan_deferred_months" label="Mois de différé d'amortissement" placeholder="0" />
          <FormNumber control={control} name="monthly_payment" label="Mensualité hors assurance" placeholder="€" />
          <FormNumber control={control} name="monthly_insurance" label="Assurance prêt mensuelle" placeholder="€" />
          <FormNumber control={control} name="remaining_capital" label="Capital restant dû" placeholder="€" />
          <FormText control={control} name="bank" label="Banque" />
        </div>
      </section>

      {/* Charges */}
      <section>
        <SectionTitle>Charges annuelles</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormNumber control={control} name="property_tax" label="Taxe foncière" placeholder="€/an" />
          <FormNumber control={control} name="pno_insurance" label="Assurance PNO" placeholder="€/an" />
          <FormNumber control={control} name="condo_fees" label="Charges copropriété" placeholder="€/an" />
          <FormNumber control={control} name="management_fees" label="Frais gestion locative" placeholder="€/an" />
          <FormNumber control={control} name="accountant_fees" label="Frais comptable" placeholder="€/an" />
          <FormNumber control={control} name="other_annual_charges" label="Autres charges" placeholder="€/an" />
        </div>
      </section>

      {/* Contacts */}
      <section>
        <SectionTitle>Contacts</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormText control={control} name="notary_contact" label="Contact notaire" />
          <FormText control={control} name="manager_contact" label="Contact gestionnaire" />
          <FormText control={control} name="syndic_contact" label="Contact syndic" />
        </div>
      </section>

      {/* Notes */}
      <section>
        <SectionTitle>Notes</SectionTitle>
        <FormTextarea control={control} name="notes" rows={3} placeholder="Notes sur le bien..." className="block" />
      </section>
    </div>
  );
}