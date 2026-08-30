import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Pencil, Trash2, Building2, TrendingUp, CreditCard, BarChart3, Upload, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import StatCard from '@/components/dashboard/StatCard';
import StatDetailModal from '@/components/property/StatDetailModal';
import LotsList from '@/components/property/LotsList';
import HoldersTab from '@/components/property/HoldersTab';
import AmortizationTable from '@/components/property/AmortizationTable';
import { formatCurrency, formatPercent, formatDateFR, calcTotalAcquisition, calcTotalAnnualCharges } from '@/lib/formatters';
import { currentCRD, getMonthlyPayment } from '@/lib/loanEngine';
import { useOwnerFilter } from '@/lib/tenantFilter';
import PropertyCashFlowMini from '@/components/property/PropertyCashFlowMini';
import ExportReportButton from '@/components/dashboard/ExportReportButton';
import { computePropertyPerformance } from '@/lib/performanceEngine';

function InfoSection({ title, items }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold pb-2 border-b border-border">{title}</h3>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
        {items.filter(i => i.value !== null && i.value !== undefined && i.value !== '' && i.value !== '—').map(item => (
          <div key={item.label}>
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="text-sm font-medium">{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const [detailModal, setDetailModal] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const targetLotId = searchParams.get('lot');
  const openLotId = searchParams.get('openLot');

  useEffect(() => {
    if (!targetLotId) return;
    const el = document.getElementById(`lot-${targetLotId}`);
    if (el) {
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-primary');
        setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 2000);
      }, 300);
    }
  }, [targetLotId]);

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['property', id],
    queryFn: () => base44.entities.Property.filter(withOwner({ id })),
  });

  const { data: lots = [] } = useQuery({
    queryKey: ['lots'],
    queryFn: () => base44.entities.Lot.filter(withOwner()),
  });
  const currentYear = new Date().getFullYear();
  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', id, currentYear],
    queryFn: () => base44.entities.Transaction.filter(withOwner({ property_id: id, year: currentYear })),
  });

  const handleEstimateValue = async () => {
    if (!property) return;
    setEstimating(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Tu es un expert immobilier français. Estime la valeur de marché actuelle de ce bien immobilier en te basant sur les données de ventes récentes (DVF, marché local 2024-2025).

Bien :
- Type : ${property.category}
- Adresse : ${[property.address, property.postal_code, property.city].filter(Boolean).join(', ')}
- Surface totale : ${property.total_surface ? property.total_surface + ' m²' : 'non renseignée'}
- Structure : ${property.holding_structure}
- Date d'acquisition : ${property.acquisition_date || 'non renseignée'}
- Prix d'achat : ${property.purchase_price ? property.purchase_price + ' €' : 'non renseigné'}
- Travaux initiaux : ${property.initial_works ? property.initial_works + ' €' : 'aucun'}
- Valeur estimée actuellement dans le système : ${property.estimated_value ? property.estimated_value + ' €' : 'non renseignée'}

Donne une estimation réaliste de la valeur vénale actuelle en €, en tenant compte du marché immobilier local, du type de bien, et de la surface. Réponds uniquement avec le JSON demandé.`,
      add_context_from_internet: true,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: 'object',
        properties: {
          estimated_value: { type: 'number' },
          price_per_sqm: { type: 'number' },
          confidence: { type: 'string' },
          explanation: { type: 'string' },
        }
      }
    });
    if (result?.estimated_value) {
      await base44.entities.Property.update(property.id, { estimated_value: result.estimated_value });
      queryClient.invalidateQueries({ queryKey: ['property', id] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      toast.success(`Valeur estimée mise à jour : ${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(result.estimated_value)}${result.price_per_sqm ? ` (${Math.round(result.price_per_sqm).toLocaleString('fr-FR')} €/m²)` : ''}`);
    } else {
      toast.error('Impossible d\'estimer la valeur, vérifiez l\'adresse et la surface.');
    }
    setEstimating(false);
  };

  const deleteMutation = useMutation({
    mutationFn: () => base44.entities.Property.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      toast.success('Bien supprimé');
      navigate('/biens');
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const property = properties[0];
  if (!property) {
    return <div className="p-8 text-center text-muted-foreground">Bien non trouvé</div>;
  }

  const propLots = lots.filter(l => l.property_id === id);
  const occupiedLots = propLots.filter(l => !l.is_vacant && l.tenant_name);
  const monthlyRent = occupiedLots.reduce((s, l) => s + (l.rent_excluding_charges || 0), 0);
  const totalAcq = calcTotalAcquisition(property);
  const mensualiteHorsAssurance = getMonthlyPayment(property);
  const totalPayment = mensualiteHorsAssurance + Number(property.monthly_insurance || 0);
  const crdLive = currentCRD(property);
  const annualCharges = calcTotalAnnualCharges(property);
  // Rentabilité canonique (performanceEngine) — même formule que Dashboard/Analyse/rapport.
  const perf = computePropertyPerformance({ property, transactions, year: currentYear, lots: propLots });
  const grossYield = perf.grossYield;
  const netYield = perf.netYield;

  const isSCI = property.holding_structure?.startsWith('SCI') || property.holding_structure === 'SARL' || property.holding_structure === 'SAS';

  const rentDetail = [
    ...occupiedLots.map(l => ({ label: l.designation, value: `${formatCurrency(l.rent_excluding_charges)} HC` })),
    { label: `${occupiedLots.length}/${propLots.length} lots occupés`, value: formatCurrency(monthlyRent), bold: true },
  ];

  const paymentDetail = [
    { label: 'Mensualité hors assurance', value: formatCurrency(property.monthly_payment) },
    { label: 'Assurance prêt', value: formatCurrency(property.monthly_insurance) },
    { label: 'Total mensualité', value: formatCurrency(totalPayment), bold: true },
  ];

  const cashflowDetail = [
    { label: 'Loyer HC mensuel', value: formatCurrency(monthlyRent) },
    { label: 'Mensualité totale', value: `- ${formatCurrency(totalPayment)}` },
    { label: 'Cashflow mensuel', value: formatCurrency(monthlyRent - totalPayment, true), bold: true, color: (monthlyRent - totalPayment) >= 0 ? 'text-emerald-600' : 'text-red-500' },
    { label: 'Cashflow annuel', value: formatCurrency((monthlyRent - totalPayment) * 12, true), color: (monthlyRent - totalPayment) >= 0 ? 'text-emerald-600' : 'text-red-500' },
  ];

  const yieldDetail = [
    { label: 'Loyer HC annuel', value: formatCurrency(perf.operatingIncome.rentalIncome) },
    { label: 'Charges non récupérables', value: `- ${formatCurrency(perf.operatingIncome.nonRecoverableOpEx)}` },
    { label: 'NOI', value: formatCurrency(perf.operatingIncome.netOperatingIncome), bold: true },
    { label: 'Coût total acquisition', value: formatCurrency(perf.acquisitionCost.total) },
    { label: 'Rendement brut', value: formatPercent(grossYield), bold: true },
    { label: 'Rendement net', value: formatPercent(netYield), bold: true },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/biens')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{property.name}</h1>
              <Badge variant="outline">{property.tax_regime}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {[property.address, property.postal_code, property.city].filter(Boolean).join(', ')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportReportButton />
          <Link to={`/biens/${id}/edit`}>
            <Button variant="outline" size="icon"><Pencil className="w-4 h-4" /></Button>
          </Link>
          <Button variant="outline" size="icon" className="text-destructive" onClick={() => {
            if (confirm('Supprimer ce bien ?')) deleteMutation.mutate();
          }}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="cursor-pointer" onClick={() => setDetailModal('rent')}>
          <StatCard label="Loyer HC mensuel" value={formatCurrency(monthlyRent)} subtitle={`${occupiedLots.length}/${propLots.length} lots occupés`} icon={Building2} />
        </div>
        <div className="cursor-pointer" onClick={() => setDetailModal('payment')}>
          <StatCard label="Mensualité totale" value={formatCurrency(totalPayment)} icon={CreditCard} />
        </div>
        <div className="cursor-pointer" onClick={() => setDetailModal('cashflow')}>
          <StatCard label="Cashflow mensuel" value={formatCurrency(monthlyRent - totalPayment, true)} icon={TrendingUp}
            className={(monthlyRent - totalPayment) >= 0 ? 'border-emerald-200' : 'border-red-200'} />
        </div>
        <div className="cursor-pointer" onClick={() => setDetailModal('yield')}>
          <StatCard label="Rendement brut" value={formatPercent(grossYield)} subtitle={`Net : ${formatPercent(netYield)}`} icon={BarChart3} />
        </div>
      </div>

      <StatDetailModal open={detailModal === 'rent'} onClose={() => setDetailModal(null)} title="Loyer HC mensuel" rows={rentDetail} />
      <StatDetailModal open={detailModal === 'payment'} onClose={() => setDetailModal(null)} title="Mensualité totale" rows={paymentDetail} />
      <StatDetailModal open={detailModal === 'cashflow'} onClose={() => setDetailModal(null)} title="Cashflow mensuel" rows={cashflowDetail} />
      <StatDetailModal open={detailModal === 'yield'} onClose={() => setDetailModal(null)} title="Rendement" rows={yieldDetail} />



      {/* Cash-flow inline */}
      <PropertyCashFlowMini propertyId={id} lots={propLots} />

      {/* Tabs */}
      <Tabs defaultValue="lots" className="space-y-4" value={targetLotId ? "lots" : undefined}>
        <TabsList>
          <TabsTrigger value="lots">Lots & Locataires</TabsTrigger>
          <TabsTrigger value="info">Informations</TabsTrigger>
          <TabsTrigger value="finance">Financement</TabsTrigger>
          <TabsTrigger value="amortization">Amortissement</TabsTrigger>
          <TabsTrigger value="holders">Détenteurs</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
        </TabsList>

        <TabsContent value="lots">
          <div className="bg-card rounded-xl border border-border p-5 space-y-6">
            <LotsList lots={propLots} propertyId={id} autoOpenLotId={openLotId} />
          </div>
        </TabsContent>

        <TabsContent value="info">
          <div className="bg-card rounded-xl border border-border p-5 space-y-6">
            <InfoSection title="Identité" items={[
              { label: 'Catégorie', value: property.category },
              { label: 'Surface totale', value: property.total_surface ? `${property.total_surface} m²` : null },
              { label: 'Adresse', value: [property.address, property.postal_code, property.city].filter(Boolean).join(', ') },
            ]} />
            <InfoSection title="Acquisition" items={[
              { label: 'Date d\'acquisition', value: formatDateFR(property.acquisition_date) },
              { label: 'Prix d\'achat', value: formatCurrency(property.purchase_price) },
              { label: 'Frais de notaire', value: formatCurrency(property.notary_fees) },
              { label: 'Frais d\'agence', value: formatCurrency(property.agency_fees) },
              { label: 'Travaux initiaux', value: formatCurrency(property.initial_works) },
              { label: 'Coût total', value: formatCurrency(totalAcq) },
            ]} />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Valeur estimée de marché</p>
                <p className="text-sm font-semibold">{property.estimated_value ? formatCurrency(property.estimated_value) : <span className="text-muted-foreground italic">Non estimée</span>}</p>
                {property.estimated_value && property.purchase_price && (
                  <p className={`text-xs font-medium mt-0.5 ${property.estimated_value >= calcTotalAcquisition(property) ? 'text-emerald-600' : 'text-red-500'}`}>
                    Plus-value latente : {formatCurrency(property.estimated_value - calcTotalAcquisition(property), true)}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleEstimateValue} disabled={estimating} className="gap-1.5 shrink-0">
                <RefreshCw className={`w-3.5 h-3.5 ${estimating ? 'animate-spin' : ''}`} />
                {estimating ? 'Estimation...' : 'MAJ estimation valeur'}
              </Button>
            </div>
            <InfoSection title="Charges annuelles" items={[
              { label: 'Taxe foncière', value: formatCurrency(property.property_tax) },
              { label: 'Assurance PNO', value: formatCurrency(property.pno_insurance) },
              { label: 'Charges copropriété', value: formatCurrency(property.condo_fees) },
              { label: 'Frais gestion', value: formatCurrency(property.management_fees) },
              { label: 'Frais comptable', value: formatCurrency(property.accountant_fees) },
              { label: 'Autres charges', value: formatCurrency(property.other_annual_charges) },
              { label: 'Total annuel', value: formatCurrency(annualCharges) },
            ]} />
          </div>
        </TabsContent>

        <TabsContent value="finance">
          <div className="bg-card rounded-xl border border-border p-5">
            <InfoSection title="Financement" items={[
              { label: 'Montant emprunté', value: formatCurrency(property.loan_amount) },
              { label: 'Apport', value: formatCurrency(property.down_payment) },
              { label: 'Date début prêt', value: formatDateFR(property.loan_start_date) },
              { label: 'Durée', value: property.loan_duration_years ? `${property.loan_duration_years} ans` : null },
              { label: 'Taux annuel', value: property.loan_rate ? `${property.loan_rate} %` : null },
              { label: 'Mensualité hors assurance', value: formatCurrency(mensualiteHorsAssurance) },
              { label: 'Assurance mensuelle', value: formatCurrency(property.monthly_insurance) },
              { label: 'Mensualité totale', value: formatCurrency(totalPayment) },
              { label: 'Capital restant dû', value: formatCurrency(crdLive) },
              { label: 'Banque', value: property.bank },
            ]} />
          </div>
        </TabsContent>

        <TabsContent value="amortization">
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold mb-4 pb-2 border-b border-border">Tableau d'amortissement</h3>
            <AmortizationTable property={property} />
          </div>
        </TabsContent>

        <TabsContent value="holders">
          <div className="bg-card rounded-xl border border-border p-5">
            <HoldersTab propertyId={id} estimatedValue={property.estimated_value} />
          </div>
        </TabsContent>

        <TabsContent value="contacts">
          <div className="bg-card rounded-xl border border-border p-5">
            <InfoSection title="Contacts" items={[
              { label: 'Notaire', value: property.notary_contact },
              { label: 'Gestionnaire', value: property.manager_contact },
              { label: 'Syndic', value: property.syndic_contact },
            ]} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}