import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, User, Home, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCurrency, formatDateFR } from '@/lib/formatters';
import { toast } from 'sonner';
import { useOwnerFilter } from '@/lib/tenantFilter';
import InviteTenantButton from '@/components/property/InviteTenantButton';
import LeasesSection from '@/components/property/LeasesSection';
import { effectiveTenants, effectiveRent, computeLeaseStatus } from '@/lib/lease';

/** Renvoie tenants[] en fusionnant éventuel legacy tenant_name */
function getLotTenants(lot) {
  const arr = Array.isArray(lot.tenants) ? [...lot.tenants] : [];
  if (lot.tenant_name && !arr.find(t => t.name === lot.tenant_name)) {
    arr.unshift({ id: 'legacy', name: lot.tenant_name, entry_date: lot.tenant_entry_date || '', exit_date: lot.tenant_exit_date || '', email: lot.tenant_email || '', phone: lot.tenant_phone || '' });
  }
  return arr;
}

const TYPOLOGIES = ["Studio", "T1", "T1bis", "T2", "T3", "T4", "T5", "T6+", "Maison", "Local commercial", "Bureau", "Parking", "Garage", "Box", "Cave", "Terrain", "T2 en Duplex", "T3 en Duplex", "T4 en Duplex"];
const LEASE_TYPES = ["Vide-Nu", "Meublé", "Bail commercial", "Bail mobilité", "Bail étudiant", "Saisonnier-Airbnb", "Bail mixte", "Courte durée"];
const DPE_CLASSES = ["A", "B", "C", "D", "E", "F", "G"];

function validateLot(data) {
  const errors = {};
  if (!data.designation?.trim()) errors.designation = 'La désignation est obligatoire';
  if (!data.property_id) errors.property_id = 'Le bien parent est obligatoire';
  if (data.surface !== null && data.surface !== undefined && data.surface !== '' && Number(data.surface) <= 0) {
    errors.surface = 'La surface doit être > 0';
  }
  const tenants = Array.isArray(data.tenants) ? data.tenants : [];
  const badTenants = tenants.filter(t => t.exit_date && t.entry_date && new Date(t.exit_date) <= new Date(t.entry_date));
  if (badTenants.length > 0) {
    errors.tenants = `La date de sortie doit être postérieure à la date d'entrée (${badTenants.map(t => t.name || 'locataire').join(', ')})`;
  }
  return errors;
}

function LotForm({ lot, propertyId, onClose }) {
  const [data, setData] = useState(lot || { property_id: propertyId });
  const [errors, setErrors] = useState({});
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const update = (field, value) => {
    setData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (lot?.id) {
        return base44.entities.Lot.update(lot.id, data);
      }
      return base44.entities.Lot.create(withOwner({ ...data, property_id: propertyId }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lots'] });
      toast.success(lot ? 'Lot mis à jour' : 'Lot créé');
      onClose();
    },
  });

  const handleSave = () => {
    const errs = validateLot(data);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast.error('Veuillez corriger les champs en erreur');
      return;
    }
    setErrors({});
    saveMutation.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Code</Label>
          <Input value={data.code || ''} onChange={e => update('code', e.target.value)} placeholder="A1" />
        </div>
        <div>
          <Label className="text-xs">Désignation *</Label>
          <Input value={data.designation || ''} onChange={e => update('designation', e.target.value)} placeholder="Appartement RDC" className={errors.designation ? 'border-destructive' : ''} />
          {errors.designation && <p className="text-xs text-destructive mt-1">{errors.designation}</p>}
        </div>
        <div>
          <Label className="text-xs">Typologie</Label>
          <Select value={data.typology || ''} onValueChange={v => update('typology', v)}>
            <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>{TYPOLOGIES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Étage</Label>
          <Input value={data.floor || ''} onChange={e => update('floor', e.target.value)} placeholder="RDC" />
        </div>
        <div>
          <Label className="text-xs">Surface m²</Label>
          <Input type="number" value={data.surface || ''} onChange={e => update('surface', Number(e.target.value))} className={errors.surface ? 'border-destructive' : ''} />
          {errors.surface && <p className="text-xs text-destructive mt-1">{errors.surface}</p>}
        </div>
      </div>
      {errors.tenants && <p className="text-xs text-destructive mt-1">{errors.tenants}</p>}

      {/* Baux : le bail est la source canonique des conditions locatives. */}
      <div className="border-t border-border pt-4">
        {data.id ? (
          <LeasesSection lot={data} />
        ) : (
          <p className="text-xs text-muted-foreground italic">
            Enregistrez le lot pour pouvoir créer son bail.
          </p>
        )}
        <div className="flex items-center justify-end mt-2">
          <Link
            to={`/locataires`}
            className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
            onClick={onClose}
          >
            <ExternalLink className="w-3 h-3" />Gérer les locataires
          </Link>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h4 className="text-xs font-semibold mb-3 text-muted-foreground">INFORMATIONS LOGEMENT</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Classe DPE</Label>
            <Select value={data.dpe_class || ''} onValueChange={v => update('dpe_class', v)}>
              <SelectTrigger><SelectValue placeholder="A → G" /></SelectTrigger>
              <SelectContent>{DPE_CLASSES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Classe GES</Label>
            <Select value={data.ges_class || ''} onValueChange={v => update('ges_class', v)}>
              <SelectTrigger><SelectValue placeholder="A → G" /></SelectTrigger>
              <SelectContent>{DPE_CLASSES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Date DPE</Label>
            <Input type="date" value={data.dpe_date || ''} onChange={e => update('dpe_date', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Consommation énergie (kWh/m²/an)</Label>
            <Input type="number" value={data.energy_consumption || ''} onChange={e => update('energy_consumption', Number(e.target.value))} placeholder="kWh/m²/an" />
          </div>
          <div>
            <Label className="text-xs">Digicode / Accès</Label>
            <Input value={data.access_code || ''} onChange={e => update('access_code', e.target.value)} placeholder="Code, badge..." />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Commentaire / Notes</Label>
            <Input value={data.comment || ''} onChange={e => update('comment', e.target.value)} placeholder="Notes libres" />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>Annuler</Button>
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  );
}

export default function LotsList({ lots, propertyId, autoOpenLotId }) {
  const [editingLot, setEditingLot] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();

  const { data: leases = [] } = useQuery({
    queryKey: ['leases'],
    queryFn: () => base44.entities.Lease.filter(withOwner()),
  });

  React.useEffect(() => {
    if (!autoOpenLotId || lots.length === 0) return;
    const lot = lots.find(l => l.id === autoOpenLotId);
    if (lot) { setEditingLot(lot); setShowForm(true); }
  }, [autoOpenLotId, lots]);

  const deleteMutation = useMutation({
    mutationFn: (lotId) => base44.entities.Lot.delete(lotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lots'] });
      toast.success('Lot supprimé');
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Lots & Locataires ({lots.length})</h3>
        <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) setEditingLot(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="w-3.5 h-3.5" />Ajouter un lot
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingLot ? `Fiche ${editingLot.designation}` : 'Nouveau lot'}</DialogTitle></DialogHeader>
            <LotForm lot={editingLot} propertyId={propertyId} onClose={() => { setShowForm(false); setEditingLot(null); }} />
          </DialogContent>
        </Dialog>
      </div>

      {lots.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <Home className="w-8 h-8 mx-auto mb-2 opacity-30" />
          Aucun lot enregistré
        </div>
      ) : (
        <div className="space-y-2">
          {lots.map(lot => (
            <div key={lot.id} id={`lot-${lot.id}`} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <button
                  className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 hover:bg-primary/20 transition-colors cursor-pointer"
                  onClick={() => { setEditingLot(lot); setShowForm(true); }}
                >
                  <Home className="w-4 h-4 text-primary" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button
                      className="font-medium text-sm truncate hover:text-primary transition-colors cursor-pointer"
                      onClick={() => { setEditingLot(lot); setShowForm(true); }}
                    >
                      {lot.designation}
                    </button>
                    {lot.typology && <Badge variant="secondary" className="text-xs">{lot.typology}</Badge>}
                    {lot.is_vacant && <Badge variant="destructive" className="text-xs">Vacant</Badge>}
                  </div>
                  {(() => {
                    const lotLeases = leases.filter(l => l.lot_id === lot.id);
                    const tenants = effectiveTenants(lot, lotLeases);
                    const rent = effectiveRent(lot, lotLeases);
                    const info = lotLeases.find(l => computeLeaseStatus(l) === 'actif');
                    if (tenants.length > 0) {
                      return (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                          <User className="w-3 h-3 shrink-0" />
                          {tenants.map((t, i) => (
                            <span key={t.id || i}>
                              <Link to={`/locataires?lot=${lot.id}`} className="hover:text-primary hover:underline transition-colors font-medium">{t.name}</Link>
                              {i < tenants.length - 1 && <span className="text-muted-foreground">,</span>}
                            </span>
                          ))}
                          <span className="ml-1 text-emerald-600 font-medium">{formatCurrency(rent)} HC</span>
                          {info?.charges > 0 && <span className="text-muted-foreground">+ {formatCurrency(info.charges)} ch.</span>}
                        </div>
                      );
                    }
                    return (
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-muted-foreground">Pas de locataire</p>
                      </div>
                    );
                  })()}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <InviteTenantButton lot={lot} />
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate(lot.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}