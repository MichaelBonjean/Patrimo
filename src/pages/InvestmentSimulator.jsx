import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Plus, Save, Trash2, Building2, Copy, X } from 'lucide-react';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { simulateScenario, EMPTY_SCENARIO } from '@/lib/investmentSimulator';
import ScenarioEditor from '@/components/simulator/ScenarioEditor';
import MetricsPanel from '@/components/simulator/MetricsPanel';
import ScenarioComparison from '@/components/simulator/ScenarioComparison';

export default function InvestmentSimulator() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { ownerEmail } = useOwnerFilter();

  const { data: scenarios = [] } = useQuery({
    queryKey: ['investment-scenarios'],
    queryFn: () => base44.entities.InvestmentScenario.list('-updated_date', 50),
  });

  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_SCENARIO);

  const active = scenarios.find((s) => s.id === activeId);
  const currentMetrics = useMemo(() => simulateScenario(draft), [draft]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['investment-scenarios'] });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const payload = { ...data, metrics: simulateScenario(data) };
      if (activeId) return base44.entities.InvestmentScenario.update(activeId, payload);
      const created = await base44.entities.InvestmentScenario.create({ ...payload, owner_id: ownerEmail });
      return created;
    },
    onSuccess: (res) => {
      invalidate();
      toast.success('Scénario enregistré');
      if (res?.id) setActiveId(res.id);
    },
    onError: () => toast.error("Échec de l'enregistrement"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.InvestmentScenario.delete(id),
    onSuccess: () => { invalidate(); toast.success('Scénario supprimé'); },
  });

  const transformMutation = useMutation({
    mutationFn: async () => {
      const a = draft.achat, f = draft.financement, e = draft.exploitation;
      const annManagement = (e.rent_monthly || 0) * 12 * (1 - (e.vacancy_rate || 0) / 100) * ((e.management_fee_rate || 0) / 100);
      const property = {
        name: draft.name || 'Bien issu du simulateur',
        category: 'Appartement',
        holding_structure: 'En propre',
        tax_regime: 'Location nue (revenus fonciers)',
        purchase_price: a.price || null,
        notary_fees: a.notary || null,
        agency_fees: a.agency || null,
        initial_works: a.works || null,
        estimated_value: a.price || null,
        down_payment: f.down_payment || null,
        loan_amount: f.loan_amount || null,
        loan_rate: f.rate || null,
        loan_duration_years: f.duration_years || null,
        loan_deferred_months: f.deferred_months || 0,
        loan_start_date: new Date().toISOString().slice(0, 10),
        monthly_payment: currentMetrics.monthlyPayment || null,
        monthly_insurance: f.insurance || null,
        remaining_capital: f.loan_amount || null,
        property_tax: e.property_tax || null,
        pno_insurance: e.insurance_pno || null,
        condo_fees: (e.charges_monthly || 0) * 12 || null,
        management_fees: annManagement || null,
        other_annual_charges: (e.maintenance || 0) + (a.furniture || 0) || null,
        notes: `Bien issu du scénario « ${draft.name} » (simulateur d'investissement).`,
        owner_id: ownerEmail,
      };
      const created = await base44.entities.Property.create(property);
      if (activeId) {
        await base44.entities.InvestmentScenario.update(activeId, { transformed_property_id: created.id });
      }
      return created;
    },
    onSuccess: (created) => {
      invalidate();
      toast.success('Bien créé — données financières reportées automatiquement');
      navigate(`/biens/${created.id}`);
    },
    onError: () => toast.error('Échec de la transformation'),
  });

  const selectScenario = (s) => {
    setActiveId(s.id);
    setDraft({ ...EMPTY_SCENARIO, ...s, achat: { ...s.achat }, financement: { ...s.financement }, exploitation: { ...s.exploitation } });
  };

  const newScenario = () => {
    setActiveId(null);
    setDraft({ ...EMPTY_SCENARIO, achat: {}, financement: {}, exploitation: {} });
  };

  const duplicate = (s) => {
    setActiveId(null);
    setDraft({
      ...s,
      name: `${s.name} (copie)`,
      achat: { ...s.achat }, financement: { ...s.financement }, exploitation: { ...s.exploitation },
      id: undefined, transformed_property_id: undefined,
    });
  };

  return (
    <div className="p-4 lg:p-8 max-w-[1400px] space-y-6">
      <div>
        <h1 className="text-xl font-bold">Simulateur d'investissement</h1>
        <p className="text-sm text-muted-foreground">Projetez un achat avant signature, comparez 2 à 4 scénarios, puis transformez le meilleur en bien réel sans ressaisie.</p>
      </div>

      {/* Barre scénarios */}
      <div className="flex flex-wrap items-center gap-2">
        {scenarios.map((s) => (
          <div
            key={s.id}
            className={cnChip(activeId === s.id)}
            onClick={() => selectScenario(s)}
            role="button"
          >
            <span className="truncate max-w-[160px]">{s.name || 'Scénario'}</span>
            {s.transformed_property_id && <Building2 className="w-3.5 h-3.5 text-chart-1 shrink-0" />}
            <button
              onClick={(ev) => { ev.stopPropagation(); duplicate(s); }}
              className="ml-1 p-0.5 hover:bg-accent rounded"
              title="Dupliquer"
              type="button"
            ><Copy className="w-3.5 h-3.5" /></button>
            <button
              onClick={(ev) => { ev.stopPropagation(); if (confirm(`Supprimer « ${s.name} » ?`)) deleteMutation.mutate(s.id); }}
              className="ml-0.5 p-0.5 hover:bg-destructive hover:text-destructive-foreground rounded"
              title="Supprimer"
              type="button"
            ><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="gap-2" onClick={newScenario}><Plus className="w-4 h-4" /> Nouveau scénario</Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Hypothèses</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="gap-2" onClick={() => setDraft(EMPTY_SCENARIO)} type="button"><X className="w-4 h-4" /> Réinitialiser</Button>
              <Button size="sm" className="gap-2" onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending} type="button">
                <Save className="w-4 h-4" /> {saveMutation.isPending ? '...' : 'Enregistrer'}
              </Button>
            </div>
          </div>
          <ScenarioEditor value={draft} onChange={setDraft} />
        </div>

        <div className="space-y-3">
          <h2 className="font-semibold text-sm">Résultats</h2>
          <MetricsPanel m={currentMetrics} />
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              className="gap-2"
              onClick={() => transformMutation.mutate()}
              disabled={transformMutation.isPending || !draft.achat?.price}
              title="Créer un bien réel avec ces données financières"
            >
              <Building2 className="w-4 h-4" />
              {transformMutation.isPending ? 'Création...' : 'Transformer en bien réel'}
            </Button>
            {active?.transformed_property_id && (
              <Button variant="outline" className="gap-2" onClick={() => navigate(`/biens/${active.transformed_property_id}`)}>
                Voir le bien lié
              </Button>
            )}
          </div>
        </div>
      </div>

      {scenarios.length >= 2 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm">Comparaison ({Math.min(scenarios.length, 4)} scénarios)</h2>
          <p className="text-xs text-muted-foreground">La meilleure valeur de chaque indicateur est surlignée en vert.</p>
          <ScenarioComparison scenarios={scenarios.map((s) => ({ ...s, metrics: s.metrics || simulateScenario(s) }))} />
        </div>
      )}
    </div>
  );
}

function cnChip(active) {
  return `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm cursor-pointer border transition-colors ${
    active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground border-border hover:bg-accent'
  }`;
}