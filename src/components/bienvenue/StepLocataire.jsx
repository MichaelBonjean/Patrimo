import React from 'react';
import { Sofa, KeyRound, MoonStar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ChoiceCard from './ChoiceCard';

const OPTIONS = [
  { key: 'meuble', icon: Sofa, title: 'Oui, en meublé' },
  { key: 'nu', icon: KeyRound, title: 'Oui, en nu' },
  { key: 'vacant', icon: MoonStar, title: 'Pas encore' },
];

export default function StepLocataire({ value, onChange }) {
  const v = value || { mode: null, tenant_name: '', rent: '', entry_date: '', duration: '' };
  const set = (patch) => onChange({ ...v, ...patch });
  const showForm = v.mode === 'meuble' || v.mode === 'nu';

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Cette étape est facultative, vous pouvez la passer.</p>
      {OPTIONS.map((o) => (
        <ChoiceCard
          key={o.key}
          icon={o.icon}
          title={o.title}
          selected={v.mode === o.key}
          onClick={() => set({ mode: o.key })}
        />
      ))}

      {showForm && (
        <div className="space-y-3 pt-1">
          <div>
            <Label className="text-xs text-muted-foreground">Nom du locataire</Label>
            <Input
              value={v.tenant_name}
              onChange={(e) => set({ tenant_name: e.target.value })}
              placeholder="Prénom Nom"
              className="h-11"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Loyer hors charges (€/mois)</Label>
            <Input
              type="number"
              value={v.rent}
              onChange={(e) => set({ rent: e.target.value })}
              placeholder="850"
              className="h-11 w-40 number-fr"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Date d'entrée</Label>
            <Input type="date" value={v.entry_date} onChange={(e) => set({ entry_date: e.target.value })} className="h-11" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Durée du bail (années)</Label>
            <Input
              type="number"
              value={v.duration}
              onChange={(e) => set({ duration: e.target.value })}
              placeholder="3"
              className="h-11 w-24 number-fr"
            />
          </div>
        </div>
      )}
    </div>
  );
}