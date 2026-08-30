import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Wallet, Landmark, Settings,
  PlusCircle, CreditCard, Upload, FileText, CalendarCheck, User, Lock, Sparkles,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useFeatureFlags, FEATURE_FLAGS } from '@/lib/featureFlags';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator,
} from '@/components/ui/command';

const NAV_ITEMS = [
  { path: '/', icon: LayoutDashboard, label: 'Accueil' },
  { path: '/biens', icon: Building2, label: 'Mes biens' },
  { path: '/loyers', icon: Wallet, label: 'Loyers' },
  { path: '/banque', icon: Landmark, label: 'Banque' },
  { path: '/reglages', icon: Settings, label: 'Réglages' },
];

const SUB_NAV = [
  { path: '/loyers?tab=quittances', icon: FileText, label: 'Quittances', parent: 'Loyers' },
  { path: '/loyers?tab=compte-locataire', icon: User, label: 'Compte locataire', parent: 'Loyers' },
  { path: '/loyers?tab=impayes', icon: FileText, label: 'Impayés', parent: 'Loyers' },
  { path: '/banque?tab=import', icon: Upload, label: 'Import bancaire', parent: 'Banque' },
  { path: '/locataires', icon: User, label: 'Locataires', parent: '' },
];

const ACTIONS = [
  { label: 'Ajouter un bien', icon: PlusCircle, path: '/biens/nouveau' },
  { label: 'Saisir un paiement', icon: CreditCard, path: '/loyers?tab=compte-locataire' },
  { label: 'Importer', icon: Upload, path: '/banque?tab=import' },
  { label: 'Générer les quittances du mois', icon: FileText, path: '/loyers?tab=quittances' },
  { label: 'Clôturer le mois', icon: CalendarCheck, path: '/banque?tab=cloture' },
];

const LOCKABLE_FEATURES = ['analyse', 'tenant_portal', 'audit_log', 'connexion_bancaire', 'sci_holders'].map((k) => ({ key: k, ...FEATURE_FLAGS[k] }));

function collectTenants(leases) {
  const out = [];
  const seen = new Set();
  for (const l of leases || []) {
    for (const t of l.tenants || []) {
      const name = (t?.name || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ key: (t.id || name) + ':' + l.id, name, lease_id: l.id });
    }
  }
  return out;
}

function dedupeProperties(props) {
  const out = [];
  const seen = new Set();
  for (const p of props || []) {
    const name = (p?.name || '').trim() || 'Bien sans nom';
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ id: p.id, name });
  }
  return out;
}

export default function CommandPalette({ open, onOpenChange }) {
  const navigate = useNavigate();
  const [properties, setProperties] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { isUnlocked } = useFeatureFlags();

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [props, leases] = await Promise.all([
          base44.entities.Property.list('-updated_date', 200),
          base44.entities.Lease.list('-updated_date', 200),
        ]);
        if (!alive) return;
        setProperties(dedupeProperties(props || []));
        setTenants(collectTenants(leases || []));
        setLoaded(true);
      } catch (e) {
        if (alive) setLoaded(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const run = (path) => {
    onOpenChange(false);
    navigate(path);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Rechercher une page, une action, un bien ou un locataire…" />
      <CommandList>
        <CommandEmpty>Aucun résultat.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {NAV_ITEMS.map((item) => (
            <CommandItem key={item.path} onSelect={() => run(item.path)}>
              <item.icon />
              <span>{item.label}</span>
            </CommandItem>
          ))}
          {SUB_NAV.map((item) => (
            <CommandItem key={item.path} onSelect={() => run(item.path)}>
              <item.icon />
              <span>{item.label}</span>
              {item.parent && <span className="ml-2 text-xs text-muted-foreground">› {item.parent}</span>}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          {ACTIONS.map((a) => (
            <CommandItem key={a.label} onSelect={() => run(a.path)}>
              <a.icon />
              <span>{a.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Fonctionnalités">
          {LOCKABLE_FEATURES.map((f) => {
            const unlocked = isUnlocked(f.key);
            return (
              <CommandItem key={f.key} disabled={!unlocked} onSelect={() => unlocked && run(f.path)}>
                {unlocked ? <Sparkles /> : <Lock />}
                <span className="flex-1">{f.label}</span>
                {!unlocked && <span className="ml-auto text-xs text-muted-foreground truncate">{f.unlockText}</span>}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Biens">
          {loading && !loaded ? (
            <CommandItem disabled>Chargement des biens…</CommandItem>
          ) : properties.length === 0 ? (
            <CommandItem disabled>Aucun bien</CommandItem>
          ) : (
            properties.map((p) => (
              <CommandItem key={p.id} onSelect={() => run(`/biens/${p.id}`)}>
                <Building2 />
                <span>{p.name}</span>
              </CommandItem>
            ))
          )}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Locataires">
          {loading && !loaded ? (
            <CommandItem disabled>Chargement des locataires…</CommandItem>
          ) : tenants.length === 0 ? (
            <CommandItem disabled>Aucun locataire</CommandItem>
          ) : (
            tenants.map((t) => (
              <CommandItem key={t.key} onSelect={() => run('/locataires')}>
                <User />
                <span>{t.name}</span>
              </CommandItem>
            ))
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}