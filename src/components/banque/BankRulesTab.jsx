import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Plus, Trash2, Zap, Pencil, Power } from 'lucide-react';
import { toast } from 'sonner';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { TRANSACTION_CATEGORIES, labelOf } from '@/lib/financeCategories';

const ALL_CATEGORIES = ["Loyer", "Charges locataire", "Caution", "CAF", "Virement interne", "Autres revenus", "Échéance prêt", "Assurance prêt", "Assurance habitation", "Électricité", "Eau", "Gaz", "Internet", "Frais SCI", "Copropriété", "Travaux", "Taxe foncière", "PNO", "Frais gestion", "Comptable", "Notaire", "Banque", "Autres charges"];

const SOURCE_LABEL = {
  manual: 'Manuelle',
  learned_from_validation: 'Apprise',
  seed: 'Héritée',
};

/**
 * Règles d'import bancaire — hébergé dans la page Banque (onglet Règles).
 * Modification / activation-désactivation / suppression + affichage de
 * l'origine, du nombre de matchs, de la cible et des conflits.
 */
export default function BankRulesTab() {
  const queryClient = useQueryClient();
  const { withOwner, ownerEmail } = useOwnerFilter();
  const [newRule, setNewRule] = useState({ keyword: '', assigned_category: '' });
  const [editing, setEditing] = useState(null);

  const { data: rules = [] } = useQuery({
    queryKey: ['bank-rules'],
    queryFn: () => base44.entities.BankRule.filter(withOwner()),
  });
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => base44.entities.Property.filter(withOwner()),
  });
  const { data: leases = [] } = useQuery({
    queryKey: ['leases'],
    queryFn: () => base44.entities.Lease.filter(withOwner()),
  });

  const createRuleMutation = useMutation({
    mutationFn: (data) => base44.entities.BankRule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-rules'] });
      setNewRule({ keyword: '', assigned_category: '' });
      toast.success('Règle créée');
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.BankRule.update(id, data),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['bank-rules'] });
      toast.success(vars?.toast || 'Règle mise à jour');
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id) => base44.entities.BankRule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-rules'] });
      toast.success('Règle supprimée');
    },
  });

  const handleAddRule = () => {
    if (!newRule.keyword || !newRule.assigned_category) {
      toast.error('Mot-clé et catégorie obligatoires');
      return;
    }
    createRuleMutation.mutate({
      ...newRule,
      owner_id: ownerEmail,
      source: 'manual',
      match_count: 0,
      history: [{ date: new Date().toISOString(), action: 'created', actor: ownerEmail, note: 'Règle manuelle' }],
    });
  };

  const appendHistory = (rule, action, note) => [
    ...(rule.history || []),
    { date: new Date().toISOString(), action, actor: ownerEmail, note: note || undefined },
  ];

  const toggleActive = (rule) => {
    updateRuleMutation.mutate({
      id: rule.id,
      data: {
        is_active: !rule.is_active,
        history: appendHistory(rule, rule.is_active ? 'disabled' : 'enabled', rule.is_active ? 'Désactivée' : 'Réactivée'),
      },
      toast: rule.is_active ? 'Règle désactivée' : 'Règle activée',
    });
  };

  const propertyLabel = (id) => properties.find((p) => p.id === id)?.name || (id ? 'Bien supprimé' : '');
  const leaseLabel = (id) => {
    if (!id) return '';
    const l = leases.find((x) => x.id === id);
    if (!l) return 'Bail supprimé';
    const t = (l.tenants || [])[0]?.name || '';
    return `Bail ${t || l.id.slice(-4)}`;
  };
  const catLabel = (cat) => (cat ? (labelOf(cat) || cat) : '—');

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center gap-2">
        <Zap className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">Règles d'import bancaire</h2>
        <Badge variant="secondary" className="text-xs ml-auto">{rules.length} règles</Badge>
      </div>
      <div className="p-6">
        {/* Création rapide (forme existante inchangée) */}
        <div className="flex items-end gap-3 mb-6 pb-6 border-b border-border flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-xs">Mot-clé (dans la description)</Label>
            <Input value={newRule.keyword} onChange={e => setNewRule(p => ({ ...p, keyword: e.target.value }))}
              placeholder="Ex: EDF, FONCIA, CAF..." className="mt-1" />
          </div>
          <div className="w-48">
            <Label className="text-xs">Catégorie</Label>
            <Select value={newRule.assigned_category} onValueChange={v => setNewRule(p => ({ ...p, assigned_category: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Catégorie" /></SelectTrigger>
              <SelectContent>{ALL_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Label className="text-xs">Bien (optionnel)</Label>
            <Select value={newRule.assigned_property_id || ''} onValueChange={v => setNewRule(p => ({ ...p, assigned_property_id: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Aucun" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucun</SelectItem>
                {properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAddRule} disabled={createRuleMutation.isPending} className="gap-1.5">
            <Plus className="w-4 h-4" />Ajouter
          </Button>
        </div>

        <div className="space-y-2">
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Aucune règle configurée. Rapprochez une transaction pour que Patrimo propose d'en créer une automatiquement.</p>
          ) : rules.map(rule => {
            const inactive = rule.is_active === false;
            return (
              <div key={rule.id} className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${inactive ? 'border-dashed border-border bg-muted/20 opacity-60' : 'border-border hover:bg-muted/30'}`}>
                <div className="flex items-center gap-3 flex-wrap min-w-0">
                  <code className="text-xs bg-muted px-2 py-1 rounded font-mono">{rule.keyword}</code>
                  <span className="text-xs text-muted-foreground">→</span>
                  <Badge variant="secondary" className="text-xs">{catLabel(rule.assigned_category)}</Badge>
                  {rule.assigned_lease_id && (
                    <Badge variant="outline" className="text-xs">{leaseLabel(rule.assigned_lease_id)}</Badge>
                  )}
                  {rule.assigned_property_id && (
                    <span className="text-xs text-muted-foreground">({propertyLabel(rule.assigned_property_id)})</span>
                  )}
                  {rule.conditions?.direction && rule.conditions.direction !== 'any' && (
                    <Badge variant="outline" className="text-xs">{rule.conditions.direction === 'in' ? 'Entrée' : 'Sortie'}</Badge>
                  )}
                  {rule.source && rule.source !== 'manual' && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">{SOURCE_LABEL[rule.source] || rule.source}</Badge>
                  )}
                  {Number(rule.match_count) > 0 && (
                    <span className="text-xs text-muted-foreground">{rule.match_count} match(s)</span>
                  )}
                  {Number(rule.priority) > 0 && (
                    <span className="text-xs text-muted-foreground">priorité {rule.priority}</span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="icon" variant="ghost" className="h-7 w-7" title={inactive ? 'Activer' : 'Désactiver'} onClick={() => toggleActive(rule)}>
                    <Power className={`w-3.5 h-3.5 ${inactive ? 'text-muted-foreground' : 'text-emerald-600'}`} />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Modifier" onClick={() => setEditing(rule)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Supprimer" onClick={() => deleteRuleMutation.mutate(rule.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <RuleEditDialog
        key={editing?.id || 'none'}
        rule={editing}
        properties={properties}
        leases={leases}
        onClose={() => setEditing(null)}
        onSave={(id, data, note) => {
          updateRuleMutation.mutate(
            { id, data, toast: 'Règle modifiée' },
            { onSuccess: () => setEditing(null) },
          );
        }}
      />
    </div>
  );
}

function RuleEditDialog({ rule, properties, leases, onClose, onSave }) {
  const [form, setForm] = useState(null);

  // Initialise le formulaire à l'ouverture.
  if (rule && !form) {
    setForm({
      keyword: rule.keyword || '',
      assigned_category: rule.assigned_category || '',
      assigned_lease_id: rule.assigned_lease_id || '',
      assigned_property_id: rule.assigned_property_id || '',
      priority: String(rule.priority ?? 0),
      direction: rule.conditions?.direction || 'any',
    });
    return null;
  }
  if (!rule) return null;

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = () => {
    const data = {
      keyword: form.keyword,
      assigned_category: form.assigned_category,
      assigned_lease_id: form.assigned_lease_id || null,
      assigned_property_id: form.assigned_property_id || null,
      priority: Number(form.priority) || 0,
      conditions: { ...(rule.conditions || {}), direction: form.direction || 'any' },
      history: [...(rule.history || []), { date: new Date().toISOString(), action: 'edited', actor: rule.owner_id, note: 'Modification manuelle' }],
    };
    onSave(rule.id, data);
  };

  return (
    <Dialog open={!!rule} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifier la règle</DialogTitle>
          <DialogDescription>Affinez le mot-clé et sa cible. Les conflits sont gérés par priorité (plus élevée = examinée en premier).</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs">Mot-clé</Label>
            <Input value={form.keyword} onChange={(e) => set('keyword', e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Catégorie</Label>
              <Select value={form.assigned_category} onValueChange={(v) => set('assigned_category', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Catégorie" /></SelectTrigger>
                <SelectContent>
                  {TRANSACTION_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{labelOf(c.value)}</SelectItem>)}
                  {ALL_CATEGORIES.filter(c => !TRANSACTION_CATEGORIES.some(tc => tc.value === c)).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Bail (loyer)</Label>
              <Select value={form.assigned_lease_id} onValueChange={(v) => set('assigned_lease_id', v === 'none' ? '' : v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Aucun" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {leases.map((l) => {
                    const t = (l.tenants || [])[0]?.name || l.id.slice(-4);
                    return <SelectItem key={l.id} value={l.id}>{t}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Bien</Label>
              <Select value={form.assigned_property_id} onValueChange={(v) => set('assigned_property_id', v === 'none' ? '' : v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Aucun" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sens du montant</Label>
              <Select value={form.direction} onValueChange={(v) => set('direction', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Indifférent</SelectItem>
                  <SelectItem value="in">Entrée</SelectItem>
                  <SelectItem value="out">Sortie</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Priorité</Label>
              <Input type="number" value={form.priority} onChange={(e) => set('priority', e.target.value)} className="mt-1" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSave} disabled={!form.keyword}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}