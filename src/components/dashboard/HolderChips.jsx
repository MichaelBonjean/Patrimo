import React from 'react';
import { Link } from 'react-router-dom';
import { User, Building2 } from 'lucide-react';
import { listPatrimonyHolders } from '@/lib/ownership';

// Chip individuelle (filtre détenteur).
function HolderChip({ active, onClick, icon: Icon, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`h-8 inline-flex items-center gap-1.5 pl-2.5 pr-3 rounded-full text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
        active
          ? 'bg-primary text-primary-foreground border-primary shadow-sm'
          : 'bg-card border-border hover:bg-muted text-foreground'
      }`}
    >
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      <span className="max-w-[160px] truncate">{children}</span>
    </button>
  );
}

// Ligne de chips détenteurs pour le Dashboard (autour du PatrimonyHero).
// - « Tout » sélectionné par défaut (filtreDashboard).
// - Personne physique → User, société → Building2.
// - Tooltip natif (title) discret avec le nombre de biens (direct(s)/indirect(s)).
// - Détection des détenteurs indirects via le moteur canonique (Holder/HolderMember/PropertyHolder).
// - État vide discret : « Détention non renseignée » + [Compléter].
// - Mobile : scroll horizontal interne (no global horizontal scroll).
export default function HolderChips({
  allHolders = [],
  allMembers = [],
  allLinks = [],
  selectedHolderId,
  onSelectHolder,
}) {
  const entries = listPatrimonyHolders({
    holders: allHolders,
    members: allMembers,
    propertyHolders: allLinks,
  });

  if (entries.length === 0) {
    return (
      <div className="flex items-center gap-2 py-0.5 overflow-x-auto no-scrollbar">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs text-muted-foreground border border-dashed border-border bg-muted/40 whitespace-nowrap">
          Détention non renseignée
        </span>
        <Link
          to="/reglages?section=detenteurs"
          className="inline-flex items-center px-2.5 py-1.5 rounded-full text-xs font-medium border border-primary/20 bg-primary/10 text-primary hover:bg-primary/20 whitespace-nowrap"
        >
          Compléter
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
      <HolderChip
        active={selectedHolderId === 'all'}
        onClick={() => onSelectHolder('all')}
        title="Tous les détenteurs"
      >
        Tout
      </HolderChip>
      {entries.map((h) => {
        const Icon = h.isPerson ? User : Building2;
        const tip = h.isPerson
          ? `${h.name} — ${h.totalPropertyCount} bien${h.totalPropertyCount > 1 ? 's' : ''} direct${h.totalPropertyCount > 1 ? 's' : ''} ou indirect${h.totalPropertyCount > 1 ? 's' : ''}`
          : `${h.name} — ${h.directPropertyCount} bien${h.directPropertyCount > 1 ? 's' : ''} détenu${h.directPropertyCount > 1 ? 's' : ''} directement`;
        return (
          <HolderChip
            key={h.id}
            active={selectedHolderId === h.id}
            onClick={() => onSelectHolder(h.id)}
            icon={Icon}
            title={tip}
          >
            {h.name}
          </HolderChip>
        );
      })}
    </div>
  );
}