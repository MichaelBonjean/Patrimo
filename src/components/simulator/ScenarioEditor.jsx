import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function NumberField({ label, value, onChange, placeholder, suffix }) {
  return (
    <div>
      <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          step="0.01"
          value={value ?? ''}
          onChange={(ev) => onChange(ev.target.value === '' ? null : Number(ev.target.value))}
          placeholder={placeholder}
          className="number-fr"
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

export default function ScenarioEditor({ value, onChange }) {
  const set = (group, field) => (v) =>
    onChange({ ...value, [group]: { ...value[group], [field]: v } });
  const setName = (v) => onChange({ ...value, name: v });

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Nom du scénario</Label>
        <Input value={value.name || ''} onChange={(e) => setName(e.target.value)} placeholder="Ex : Appartement T2 Lyon 3" />
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Achat</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <NumberField label="Prix d'achat" value={value.achat.price} onChange={set('achat', 'price')} suffix="€" />
          <NumberField label="Frais de notaire" value={value.achat.notary} onChange={set('achat', 'notary')} suffix="€" />
          <NumberField label="Frais d'agence" value={value.achat.agency} onChange={set('achat', 'agency')} suffix="€" />
          <NumberField label="Travaux" value={value.achat.works} onChange={set('achat', 'works')} suffix="€" />
          <NumberField label="Meubles" value={value.achat.furniture} onChange={set('achat', 'furniture')} suffix="€" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Financement</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <NumberField label="Apport" value={value.financement.down_payment} onChange={set('financement', 'down_payment')} suffix="€" />
          <NumberField label="Emprunt" value={value.financement.loan_amount} onChange={set('financement', 'loan_amount')} suffix="€" />
          <NumberField label="Taux" value={value.financement.rate} onChange={set('financement', 'rate')} suffix="% /an" />
          <NumberField label="Durée" value={value.financement.duration_years} onChange={set('financement', 'duration_years')} suffix="ans" />
          <NumberField label="Assurance" value={value.financement.insurance} onChange={set('financement', 'insurance')} suffix="€/mois" />
          <NumberField label="Différé" value={value.financement.deferred_months} onChange={set('financement', 'deferred_months')} suffix="mois" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Exploitation</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <NumberField label="Loyer HC" value={value.exploitation.rent_monthly} onChange={set('exploitation', 'rent_monthly')} suffix="€/mois" />
          <NumberField label="Charges non récup." value={value.exploitation.charges_monthly} onChange={set('exploitation', 'charges_monthly')} suffix="€/mois" />
          <NumberField label="Taxe foncière" value={value.exploitation.property_tax} onChange={set('exploitation', 'property_tax')} suffix="€/an" />
          <NumberField label="Vacance" value={value.exploitation.vacancy_rate} onChange={set('exploitation', 'vacancy_rate')} suffix="%" />
          <NumberField label="Frais gestion" value={value.exploitation.management_fee_rate} onChange={set('exploitation', 'management_fee_rate')} suffix="%" />
          <NumberField label="Assurance PNO" value={value.exploitation.insurance_pno} onChange={set('exploitation', 'insurance_pno')} suffix="€/an" />
          <NumberField label="Entretien" value={value.exploitation.maintenance} onChange={set('exploitation', 'maintenance')} suffix="€/an" />
        </CardContent>
      </Card>
    </div>
  );
}