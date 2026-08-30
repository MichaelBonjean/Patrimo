import React, { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { generatePatrimoineReport } from '@/lib/patrimonyReport';

// Bouton "Dossier patrimonial" — réutilisable partout (Dashboard, PropertyDetail, Réglages › Documents).
// Si `properties` n'est pas fourni, fetch seul le portefeuille complet de l'utilisateur.
export default function ExportReportButton({ properties, lots, allLinks, allHolders, label = 'Dossier patrimonial', size = 'sm' }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      const me = user || (await base44.auth.me());
      const ownerName = me?.full_name || me?.email || 'Détenteur';
      const ownerId = me?.email;
      const logoUrl = me?.data?.report_logo_url;

      let p = properties, l = lots, al = allLinks, ah = allHolders;
      if (!p) {
        const [pp, ll, links, holders] = await Promise.all([
          base44.entities.Property.filter({ owner_id: ownerId }),
          base44.entities.Lot.filter({ owner_id: ownerId }),
          base44.entities.PropertyHolder.filter({ owner_id: ownerId }),
          base44.entities.Holder.filter({ owner_id: ownerId }),
        ]);
        p = pp; l = ll; al = links; ah = holders;
      }
      if (!p || p.length === 0) { toast.error('Aucun bien à exporter'); return; }

      await generatePatrimoineReport({
        properties: p, lots: l || [], allLinks: al || [], allHolders: ah || [],
        ownerName, ownerId, logoUrl,
      });
      toast.success('Dossier patrimonial généré');
    } catch (e) {
      console.error(e);
      toast.error(e?.message || 'Échec de la génération du dossier');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size={size} onClick={handleClick} disabled={busy} className="shrink-0 gap-2">
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
      {busy ? 'Génération…' : label}
    </Button>
  );
}