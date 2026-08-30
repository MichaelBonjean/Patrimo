import React from 'react';
import { Home, Building2, Layers } from 'lucide-react';
import ChoiceCard from './ChoiceCard';

const OPTIONS = [
  { key: 'physique', icon: Home, title: '1 à 3 biens en propre', subtitle: 'Vous détenez seul(e) en personne physique.' },
  { key: 'sci', icon: Building2, title: 'Des biens en SCI ou société', subtitle: 'Avec des associés, via une structure juridique.' },
  { key: 'mix', icon: Layers, title: 'Un mix personnel + SCI', subtitle: 'Certains biens en propre, d\'ailleurs en société.' },
];

export default function StepContext({ value, onSelect }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        On adapte la suite selon votre situation. Vous pourrez tout modifier ensuite.
      </p>
      {OPTIONS.map((o) => (
        <ChoiceCard
          key={o.key}
          icon={o.icon}
          title={o.title}
          subtitle={o.subtitle}
          selected={value === o.key}
          onClick={() => onSelect(o.key)}
        />
      ))}
    </div>
  );
}