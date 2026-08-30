import React from 'react';
import { Camera, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ChoiceCard from './ChoiceCard';

export default function StepPremierBien({ value, onChange }) {
  const v = value || { mode: null, name: '', address: '', monthly_rent: '' };
  const set = (patch) => onChange({ ...v, ...patch });
  const showForm = v.mode === 'form';

  return (
    <div className="space-y-3">
      <ChoiceCard
        icon={Camera}
        title="Photographier mon acte / bail"
        subtitle="Recommandé — l'IA lit le document et pré-remplit tout."
        selected={v.mode === 'photo'}
        onClick={() => set({ mode: 'photo' })}
      />
      <ChoiceCard
        icon={Pencil}
        title="Saisir en 3 champs"
        subtitle="Ultra-rapide, vous complèterez plus tard."
        selected={showForm}
        onClick={() => set({ mode: 'form' })}
      />

      {showForm && (
        <div className="space-y-3 pt-1">
          <div>
            <Label className="text-xs text-muted-foreground">Nom du bien</Label>
            <Input
              value={v.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Ex : Appartement rue Lafayette"
              className="h-11"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Adresse</Label>
            <Input
              value={v.address}
              onChange={(e) => set({ address: e.target.value })}
              placeholder="12 rue des Lilas, 69003 Lyon"
              className="h-11"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Loyer mensuel (optionnel)</Label>
            <Input
              type="number"
              value={v.monthly_rent}
              onChange={(e) => set({ monthly_rent: e.target.value })}
              placeholder="850"
              className="h-11 w-40 number-fr"
            />
          </div>
        </div>
      )}
    </div>
  );
}