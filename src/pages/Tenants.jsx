import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Search, Users, Mail, Phone, Building2, Plus, Trash2 } from 'lucide-react';
import { formatCurrency, formatDateFR } from '@/lib/formatters';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useOwnerFilter } from '@/lib/tenantFilter';
import OnboardingEmptyState from '@/components/OnboardingEmptyState';
import { pickActiveLease, computeLeaseStatus, statusLabel, statusBadgeClass, sortLeases } from '@/lib/lease';

// ── helpers ────────────────────────────────────────────────────────────────

/** Renvoie le tableau tenants[] en fusionnant l'éventuel legacy tenant_name */
function getLotTenants(lot) {
  const arr = Array.isArray(lot.tenants) ? [...lot.tenants] : [];
  // Migration legacy : si tenant_name existe et n'est pas dans tenants[]
  if (lot.tenant_name && !arr.find(t => t.name === lot.tenant_name)) {
    arr.unshift({
      id: 'legacy',
      name: lot.tenant_name,
      entry_date: lot.tenant_entry_date || '',
      exit_date: lot.tenant_exit_date || '',
      email: lot.tenant_email || '',
      phone: lot.tenant_phone || '',
    });
  }
  return arr;
}

function isActiveTenant(t, today) {
  return !t.exit_date || t.exit_date >= today;
}

// ── PhoneButton / EmailButton ───────────────────────────────────────────────

function PhoneButton({ phone }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const show = () => setVisible(true);
  const handleClick = (e) => {
    e.preventDefault();
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 10000);
  };
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return (
    <div className="relative">
      <button onClick={handleClick} onMouseEnter={show} onMouseLeave={() => { if (!timerRef.current) setVisible(false); }} className="p-2 rounded-lg hover:bg-muted transition-colors">
        <Phone className="w-4 h-4 text-muted-foreground" />
      </button>
      {visible && (
        <div className="absolute right-0 bottom-full mb-1.5 z-50 bg-foreground text-background text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap">
          {phone}
          <div className="absolute right-3 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-foreground" />
        </div>
      )}
    </div>
  );
}

function EmailButton({ email }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const handleClick = (e) => {
    e.preventDefault();
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 10000);
  };
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return (
    <div className="relative">
      <button onClick={handleClick} onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)} className="p-2 rounded-lg hover:bg-muted transition-colors">
        <Mail className="w-4 h-4 text-muted-foreground" />
      </button>
      {visible && (
        <div className="absolute right-0 bottom-full mb-1.5 z-50 bg-foreground text-background text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap">
          {email}
          <div className="absolute right-3 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-foreground" />
        </div>
      )}
    </div>
  );
}

// ── TenantEditModal ─────────────────────────────────────────────────────────
// Édite un locataire précis (identifié par tenantId) dans tenants[] du lot

function TenantEditModal({ lot, tenantId, onClose, propertyName }) {
  const queryClient = useQueryClient();
  const allTenants = getLotTenants(lot);
  const original = allTenants.find(t => t.id === tenantId) || allTenants[0] || {};
  const [data, setData] = useState({ ...original });
  const update = (f, v) => setData(p => ({ ...p, [f]: v }));

  const saveMutation = useMutation({
    mutationFn: () => {
      // Rebuild tenants array with updated entry
      const newTenants = getLotTenants(lot).map(t =>
        t.id === data.id ? data : t
      );
      return base44.entities.Lot.update(lot.id, {
        tenants: newTenants,
        // clear legacy fields if this was the legacy tenant
        ...(data.id === 'legacy' ? {
          tenant_name: data.name,
          tenant_entry_date: data.entry_date,
          tenant_exit_date: data.exit_date,
          tenant_email: data.email,
          tenant_phone: data.phone,
        } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lots'] });
      toast.success('Locataire mis à jour');
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      const newTenants = getLotTenants(lot).filter(t => t.id !== data.id);
      return base44.entities.Lot.update(lot.id, {
        tenants: newTenants,
        ...(data.id === 'legacy' ? { tenant_name: null, tenant_entry_date: null, tenant_exit_date: null, tenant_email: null, tenant_phone: null } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lots'] });
      toast.success('Locataire supprimé');
      onClose();
    },
  });

  return (
    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Fiche locataire — {data.name}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label className="text-xs">Prénom(s) et Nom</Label>
          <Input value={data.name || ''} onChange={e => update('name', e.target.value)} placeholder="Prénom(s) Nom" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Date d'entrée</Label>
            <Input type="date" value={data.entry_date || ''} onChange={e => update('entry_date', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Date de sortie</Label>
            <Input type="date" value={data.exit_date || ''} onChange={e => update('exit_date', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Email</Label>
            <Input value={data.email || ''} onChange={e => update('email', e.target.value)} placeholder="email@example.com" />
          </div>
          <div>
            <Label className="text-xs">Téléphone</Label>
            <Input value={data.phone || ''} onChange={e => update('phone', e.target.value)} placeholder="+33..." />
          </div>
        </div>

        {/* Conditions financières en lecture seule */}
        {(lot.rent_excluding_charges || lot.charges || lot.deposit) && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Conditions financières — modifiables dans la fiche lot</p>
            <div className="grid grid-cols-3 gap-3">
              {lot.rent_excluding_charges && (
                <div>
                  <Label className="text-xs text-muted-foreground">Loyer HC</Label>
                  <div className="h-8 px-3 rounded-md border border-border bg-muted/60 text-xs flex items-center text-muted-foreground">{lot.rent_excluding_charges} €</div>
                </div>
              )}
              {lot.charges && (
                <div>
                  <Label className="text-xs text-muted-foreground">Charges</Label>
                  <div className="h-8 px-3 rounded-md border border-border bg-muted/60 text-xs flex items-center text-muted-foreground">{lot.charges} €</div>
                </div>
              )}
              {lot.deposit && (
                <div>
                  <Label className="text-xs text-muted-foreground">Caution</Label>
                  <div className="h-8 px-3 rounded-md border border-border bg-muted/60 text-xs flex items-center text-muted-foreground">{lot.deposit} €</div>
                </div>
              )}
            </div>
            <Link to={`/biens/${lot.property_id}?openLot=${lot.id}`} className="flex items-center gap-1.5 text-xs text-primary hover:underline font-medium" onClick={onClose}>
              <Building2 className="w-3.5 h-3.5" />{propertyName} — {lot.designation}
            </Link>
          </div>
        )}

        <div className="flex justify-between items-center pt-2 border-t">
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
            <Trash2 className="w-3.5 h-3.5 mr-1" />Supprimer
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Annuler</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

// ── NewTenantModal ──────────────────────────────────────────────────────────

function NewTenantModal({ lots, properties, onClose }) {
  const queryClient = useQueryClient();
  const [data, setData] = useState({ name: '', entry_date: '', exit_date: '', email: '', phone: '' });
  const [selectedLotId, setSelectedLotId] = useState('');
  const selectedLot = lots.find(l => l.id === selectedLotId);
  const update = (f, v) => setData(p => ({ ...p, [f]: v }));
  const getPropertyName = (propId) => properties.find(p => p.id === propId)?.name || '—';

  const saveMutation = useMutation({
    mutationFn: () => {
      const existing = getLotTenants(selectedLot);
      const newTenant = {
        id: crypto.randomUUID(),
        name: data.name,
        entry_date: data.entry_date || '',
        exit_date: data.exit_date || '',
        email: data.email || '',
        phone: data.phone || '',
      };
      return base44.entities.Lot.update(selectedLotId, {
        tenants: [...existing, newTenant],
        is_vacant: false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lots'] });
      toast.success('Locataire ajouté');
      onClose();
    },
  });

  const handleSave = () => {
    if (!selectedLotId) { toast.error('Sélectionnez un lot'); return; }
    if (!data.name) { toast.error('Le nom est obligatoire'); return; }
    saveMutation.mutate();
  };

  return (
    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Nouveau locataire</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div>
          <Label className="text-xs">Lot *</Label>
          <Select value={selectedLotId} onValueChange={setSelectedLotId}>
            <SelectTrigger><SelectValue placeholder="Choisir un lot" /></SelectTrigger>
            <SelectContent>
              {lots.map(l => {
                const existing = getLotTenants(l);
                const label = existing.length > 0 ? ` (${existing.map(t => t.name).join(', ')})` : '';
                return (
                  <SelectItem key={l.id} value={l.id}>
                    {getPropertyName(l.property_id)} — {l.designation}{label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {selectedLot && getLotTenants(selectedLot).length > 0 && (
            <p className="text-xs text-amber-600 mt-1">
              Ce lot est déjà occupé — le nouveau locataire sera ajouté en co-occupation.
            </p>
          )}
        </div>

        <div>
          <Label className="text-xs">Prénom(s) et Nom *</Label>
          <Input value={data.name} onChange={e => update('name', e.target.value)} placeholder="Prénom(s) Nom" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Date d'entrée</Label>
            <Input type="date" value={data.entry_date} onChange={e => update('entry_date', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Date de sortie</Label>
            <Input type="date" value={data.exit_date} onChange={e => update('exit_date', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Email</Label>
            <Input value={data.email} onChange={e => update('email', e.target.value)} placeholder="email@example.com" />
          </div>
          <div>
            <Label className="text-xs">Téléphone</Label>
            <Input value={data.phone} onChange={e => update('phone', e.target.value)} placeholder="+33..." />
          </div>
        </div>

        {selectedLot && (
          <div className="rounded-md bg-muted/40 border border-border p-2.5 text-xs text-muted-foreground">
            Loyer HC : <strong>{selectedLot.rent_excluding_charges ? formatCurrency(selectedLot.rent_excluding_charges) : '—'}</strong>
            {' · '}Charges : <strong>{formatCurrency(selectedLot.charges ?? 0)}</strong>
            {' · '}Caution : <strong>{selectedLot.deposit ? formatCurrency(selectedLot.deposit) : '—'}</strong>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Enregistrement...' : 'Créer'}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

// ── Page principale ─────────────────────────────────────────────────────────

export default function Tenants() {
  const [search, setSearch] = useState('');
  const [filterProperty, setFilterProperty] = useState('all');
  const [editingTenant, setEditingTenant] = useState(null); // { lot, tenantId }
  const [showNewTenant, setShowNewTenant] = useState(false);
  const location = useLocation();
  const { withOwner } = useOwnerFilter();

  const { data: lots = [] } = useQuery({
    queryKey: ['lots'],
    queryFn: () => base44.entities.Lot.filter(withOwner()),
  });

  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => base44.entities.Property.filter(withOwner()),
  });

  const { data: leases = [] } = useQuery({
    queryKey: ['leases'],
    queryFn: () => base44.entities.Lease.filter(withOwner()),
  });

  const getPropertyName = (propId) => properties.find(p => p.id === propId)?.name || '—';
  const today = new Date().toISOString().split('T')[0];

  // Construit les lignes locataires à partir des bails (source canonique).
  // Chaque bail actif génère une ligne par locataire ; repli legacy si aucun bail.
  function buildLeaseRows(lot) {
    const lotLeases = leases.filter(l => l.lot_id === lot.id);
    if (lotLeases.length === 0) return null; // signal repli
    const active = pickActiveLease(lotLeases, today);
    const rows = [];
    const propName = getPropertyName(lot.property_id);
    // Baux terminés → anciens locataires (un bail = une période d'occupation)
    for (const lease of sortLeases(lotLeases)) {
      const st = computeLeaseStatus(lease, today);
      for (const t of (lease.tenants || [])) {
        rows.push({
          lot, lease, tenant: t, propertyName: propName,
          isHistoric: st === 'termine' || st === 'resilie',
        });
      }
    }
    return { active, rows };
  }

  // Auto-open from ?lot= param (ouvre le 1er locataire du lot)
  useEffect(() => {
    if (lots.length === 0) return;
    const params = new URLSearchParams(location.search);
    const lotId = params.get('lot');
    if (lotId) {
      const lot = lots.find(l => l.id === lotId);
      if (lot) {
        const tenants = getLotTenants(lot);
        if (tenants.length > 0) setEditingTenant({ lot, tenantId: tenants[0].id });
      }
    }
  }, [lots, location.search]);

  if (properties.length === 0) {
    return (
      <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Locataires</h1>
          <p className="text-sm text-muted-foreground mt-1">0 locataire actuel</p>
        </div>
        <OnboardingEmptyState icon={Users} />
      </div>
    );
  }

  // Construire la liste à plat : un item par locataire.
  // Priorité au modèle Lease (bail) ; repli sur les champs legacy du lot.
  const currentTenantRows = [];
  const formerTenantRows = [];

  for (const lot of lots) {
    const built = buildLeaseRows(lot);
    if (built) {
      for (const r of built.rows) {
        const leaseActive = computeLeaseStatus(r.lease, today) === 'actif';
        const tenantActive = !r.tenant.exit_date || r.tenant.exit_date >= today;
        if (leaseActive && tenantActive) currentTenantRows.push(r);
        else formerTenantRows.push(r);
      }
      continue;
    }
    // Repli legacy
    const tenants = getLotTenants(lot);
    for (const t of tenants) {
      const row = { lot, tenant: t, propertyName: getPropertyName(lot.property_id) };
      if (isActiveTenant(t, today)) currentTenantRows.push(row);
      else formerTenantRows.push(row);
    }
    for (const pt of (lot.previous_tenants || [])) {
      formerTenantRows.push({ lot, tenant: { ...pt, id: null }, propertyName: getPropertyName(lot.property_id), isHistoric: true });
    }
  }

  const filterRows = (rows) => rows.filter(({ lot, tenant }) => {
    const matchSearch = !search || tenant.name?.toLowerCase().includes(search.toLowerCase());
    const matchProperty = filterProperty === 'all' || lot.property_id === filterProperty;
    return matchSearch && matchProperty;
  });

  const filteredCurrent = filterRows(currentTenantRows);
  const filteredFormer = filterRows(formerTenantRows);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Locataires</h1>
          <p className="text-sm text-muted-foreground mt-1">{currentTenantRows.length} locataire{currentTenantRows.length > 1 ? 's' : ''} actuel{currentTenantRows.length > 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" onClick={() => setShowNewTenant(true)}>
            <Plus className="w-4 h-4" /> Ajouter un locataire
          </Button>
        </div>
      </div>

      <Dialog open={showNewTenant} onOpenChange={setShowNewTenant}>
        {showNewTenant && <NewTenantModal lots={lots} properties={properties} onClose={() => setShowNewTenant(false)} />}
      </Dialog>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Rechercher un locataire..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterProperty} onValueChange={setFilterProperty}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Filtrer par bien" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les biens</SelectItem>
            {properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="current">
        <TabsList>
          <TabsTrigger value="current">Actuels ({filteredCurrent.length})</TabsTrigger>
          <TabsTrigger value="previous">Anciens ({filteredFormer.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="current">
          {filteredCurrent.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-12 text-center">
              <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Aucun locataire trouvé</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredCurrent.map(({ lot, tenant, propertyName, lease }) => (
                <div key={`${lot.id}-${tenant.id}`} className="bg-card rounded-xl border border-border p-4 flex items-center justify-between hover:shadow-sm transition-shadow">
                  <Dialog
                    open={editingTenant?.lot?.id === lot.id && editingTenant?.tenantId === tenant.id}
                    onOpenChange={open => setEditingTenant(open ? { lot, tenantId: tenant.id } : null)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-sm font-semibold text-primary">{tenant.name?.charAt(0)?.toUpperCase()}</span>
                      </div>
                      <div>
                        <button className="font-semibold text-sm hover:text-primary transition-colors text-left" onClick={() => setEditingTenant({ lot, tenantId: tenant.id })}>
                          {tenant.name}
                        </button>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <Link to={`/biens/${lot.property_id}?openLot=${lot.id}`} className="flex items-center gap-1 hover:text-primary transition-colors" onClick={e => e.stopPropagation()}>
                            <Building2 className="w-3 h-3" />
                            {propertyName} — {lot.designation}
                          </Link>
                          {lot.lease_type && <Badge variant="secondary" className="text-xs">{lot.lease_type}</Badge>}
                        </div>
                      </div>
                    </div>
                    {editingTenant?.lot?.id === lot.id && editingTenant?.tenantId === tenant.id && (
                      <TenantEditModal lot={lot} tenantId={tenant.id} propertyName={propertyName} onClose={() => setEditingTenant(null)} />
                    )}
                  </Dialog>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-right">
                      <p className="font-semibold text-emerald-600">{formatCurrency(lease?.rent_excluding_charges ?? lot.rent_excluding_charges)} HC</p>
                      {(lease?.charges ?? lot.charges) > 0 && <p className="text-xs text-muted-foreground">{formatCurrency(lease?.charges ?? lot.charges)} ch.</p>}
                      {lease && <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] ${statusBadgeClass(computeLeaseStatus(lease, today))}`}>{statusLabel(computeLeaseStatus(lease, today))}</span>}
                      {tenant.entry_date && <p className="text-xs text-muted-foreground">depuis {formatDateFR(tenant.entry_date)}</p>}
                      {tenant.exit_date && <p className="text-xs text-amber-500">sortie : {formatDateFR(tenant.exit_date)}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {tenant.email && <EmailButton email={tenant.email} />}
                      {tenant.phone && <PhoneButton phone={tenant.phone} />}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="previous">
          {filteredFormer.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-12 text-center">
              <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Aucun ancien locataire</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredFormer.map(({ lot, tenant, propertyName, isHistoric }, idx) => (
                <div key={idx} className={`bg-card rounded-xl border border-border p-4 flex items-center justify-between opacity-80 ${!isHistoric ? 'hover:shadow-sm hover:opacity-100 transition-all' : ''}`}>
                  <Dialog
                    open={!isHistoric && editingTenant?.lot?.id === lot.id && editingTenant?.tenantId === tenant.id}
                    onOpenChange={open => !isHistoric && setEditingTenant(open ? { lot, tenantId: tenant.id } : null)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <span className="text-sm font-semibold text-muted-foreground">{tenant.name?.charAt(0)?.toUpperCase()}</span>
                      </div>
                      <div>
                        {!isHistoric ? (
                          <button className="font-medium text-sm hover:text-primary transition-colors text-left" onClick={() => setEditingTenant({ lot, tenantId: tenant.id })}>
                            {tenant.name}
                          </button>
                        ) : (
                          <p className="font-medium text-sm">{tenant.name}</p>
                        )}
                        <p className="text-xs text-muted-foreground">{propertyName} — {lot.designation}</p>
                      </div>
                    </div>
                    {!isHistoric && editingTenant?.lot?.id === lot.id && editingTenant?.tenantId === tenant.id && (
                      <TenantEditModal lot={lot} tenantId={tenant.id} propertyName={propertyName} onClose={() => setEditingTenant(null)} />
                    )}
                  </Dialog>
                  <div className="text-right text-sm">
                    <p className="text-muted-foreground">{formatCurrency(lot.rent_excluding_charges)} HC</p>
                    <p className="text-xs text-muted-foreground">{formatDateFR(tenant.entry_date)} → {formatDateFR(tenant.exit_date)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}