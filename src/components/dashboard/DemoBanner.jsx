import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { clearDemoData } from '@/lib/demoSeed';

export default function DemoBanner() {
  const queryClient = useQueryClient();
  const { ownerEmail } = useOwnerFilter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSwitch = async () => {
    setDeleting(true);
    try {
      await clearDemoData(ownerEmail);
      await queryClient.invalidateQueries();
      toast.success('Données de démo supprimées — compte réel prêt');
      setConfirming(false);
    } catch (e) {
      toast.error('Erreur lors de la suppression des données de démo');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Badge className="bg-amber-100 text-amber-800 border-0 gap-1">
        <Sparkles className="w-3 h-3" /> Données de démo
      </Badge>
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">Supprimer toutes les données de démo ?</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirming(false)} disabled={deleting}>Annuler</Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleSwitch} disabled={deleting}>
            {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirmer'}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirming(true)}>
          Basculer en compte réel
        </Button>
      )}
    </div>
  );
}