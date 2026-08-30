import React from 'react';
import { Plus, Trash2, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const EMPTY = { name: '', share: '' };

export default function StepStructure({ value, onChange }) {
  const v = value || { denomination: '', associates: [{ ...EMPTY }] };
  const set = (patch) => onChange({ ...v, ...patch });
  const setAssoc = (i, field, val) => {
    const next = v.associates.map((a, j) => (j === i ? { ...a, [field]: val } : a));
    set({ associates: next });
  };
  const addAssoc = () => set({ associates: [...v.associates, { ...EMPTY }] });
  const removeAssoc = (i) => set({ associates: v.associates.filter((_, j) => j !== i) || [{ ...EMPTY }] });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        On crée votre structure maintenant. Vous complèterez le SIRET et le capital plus tard dans Réglages.
      </p>

      <div>
        <Label className="text-xs text-muted-foreground">Dénomination sociale</Label>
        <Input
          value={v.denomination}
          onChange={(e) => set({ denomination: e.target.value })}
          placeholder="Ex : SCI Familia Invest"
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Vos associés (nom + part en %)</Label>
          <Button type="button" variant="ghost" size="sm" onClick={addAssoc} className="gap-1 h-8">
            <Plus className="w-3.5 h-3.5" /> Ajouter
          </Button>
        </div>
        {v.associates.map((a, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Input
              value={a.name}
              onChange={(e) => setAssoc(i, 'name', e.target.value)}
              placeholder="Nom de l'associé"
              className="h-11 flex-1"
            />
            <Input
              type="number"
              value={a.share}
              onChange={(e) => setAssoc(i, 'share', e.target.value)}
              placeholder="50"
              className="h-11 w-24 number-fr"
            />
            {v.associates.length > 1 && (
              <Button type="button" variant="ghost" size="icon" onClick={() => removeAssoc(i)} className="shrink-0">
                <Trash2 className="w-4 h-4 text-muted-foreground" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => toast.info('Vous pourrez ajouter vos statuts et Kbis depuis Réglages à la fin de l\'onboarding.')}
        className="w-full text-left rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground hover:bg-muted/40 flex items-start gap-2"
      >
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Ajouter automatiquement mes statuts / Kbis (IA remplit tout) — disponible après l'onboarding.</span>
      </button>
    </div>
  );
}