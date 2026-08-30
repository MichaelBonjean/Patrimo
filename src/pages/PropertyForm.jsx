import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Save } from 'lucide-react';
import { toast } from 'sonner';
import PropertyFormFields from '@/components/property/PropertyFormFields';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { propertySchema } from '@/lib/schemas/property.schema';
import { triggerMilestone } from '@/lib/celebrations';

export default function PropertyForm() {
  const { id } = useParams();
  const isNew = !id || id === 'nouveau';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { withOwner, ownerEmail } = useOwnerFilter();

  const form = useForm({
    resolver: zodResolver(propertySchema),
    mode: 'onChange',
    defaultValues: {
      name: '', category: '', total_surface: null, address: '', postal_code: '', city: '',
      holding_structure: '', tax_regime: '', sci_name: '', sci_siret: '', sci_capital: null,
      sci_creation_date: '', sci_bank: '', acquisition_date: '', purchase_price: null,
      notary_fees: null, agency_fees: null, initial_works: null, estimated_value: null,
      loan_amount: null, down_payment: null, loan_start_date: '', loan_duration_years: null,
      loan_rate: null, loan_deferred_months: null, monthly_payment: null, monthly_insurance: null,
      remaining_capital: null, bank: '', property_tax: null, pno_insurance: null, condo_fees: null,
      management_fees: null, accountant_fees: null, other_annual_charges: null,
      notary_contact: '', manager_contact: '', syndic_contact: '', notes: '',
    },
  });

  const { data: property, isLoading } = useQuery({
    queryKey: ['property', id],
    queryFn: () => base44.entities.Property.filter(withOwner({ id })),
    enabled: !isNew,
  });

  useEffect(() => {
    if (property && property.length > 0) form.reset(property[0]);
  }, [property]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMutation = useMutation({
    mutationFn: async (formData) => {
      if (isNew) {
        return base44.entities.Property.create({ ...formData, owner_id: ownerEmail });
      } else {
        return base44.entities.Property.update(id, formData);
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['property', id] });
      toast.success(isNew ? 'Bien créé avec succès' : 'Bien mis à jour');
      if (isNew && result?.id) navigate(`/biens/${result.id}`);
      else if (isNew) navigate('/biens');
      if (isNew) {
        triggerMilestone('first_property_added');
        base44.entities.Property.filter(withOwner()).then((ps) => {
          if ((ps || []).length >= 5) triggerMilestone('5_properties');
        }).catch(() => {});
      }
    },
  });

  const onSubmit = (values) => saveMutation.mutate(values);

  if (isLoading && !isNew) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const name = form.watch('name');

  return (
    <div className="p-6 lg:p-8 max-w-[1200px]">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">{isNew ? 'Nouveau bien' : `Modifier : ${name || ''}`}</h1>
            <p className="text-sm text-muted-foreground">Les champs marqués d'un * sont obligatoires</p>
          </div>
        </div>
        <Button onClick={form.handleSubmit(onSubmit)} disabled={saveMutation.isPending} className="gap-2">
          <Save className="w-4 h-4" />
          {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </Button>
      </div>

      <div className="bg-card rounded-xl border border-border p-6">
        <PropertyFormFields form={form} />
      </div>
    </div>
  );
}