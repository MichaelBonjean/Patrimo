import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { seedDemoData } from '@/lib/demoSeed';

/**
 * État vide d'onboarding affiché sur les pages principales quand l'utilisateur
 * n'a encore aucun bien. Style shadcn, minimaliste.
 */
export default function OnboardingEmptyState({ icon: Icon = Building2 }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [seeding, setSeeding] = useState(false);

  const handleSeed = async () => {
    const ownerEmail = user?.email;
    if (!ownerEmail) {
      toast.error('Impossible de charger votre compte');
      return;
    }
    setSeeding(true);
    try {
      const count = await seedDemoData(ownerEmail);
      await qc.invalidateQueries();
      toast.success(`Jeu de démo chargé — ${count} transactions créées`);
    } catch (e) {
      toast.error(e?.message || 'Erreur lors du chargement du jeu de données');
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-4">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-5">
        <Icon className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight">Prêt à piloter votre patrimoine ?</h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-md">
        Ajoutez vos biens, lots et transactions pour suivre rentabilité, cashflow et fiscalité en temps réel.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 mt-6">
        <Link to="/onboarding">
          <Button className="gap-1.5 w-full sm:w-auto">
            <Sparkles className="w-4 h-4" />
            Démarrer l'onboarding guidé
          </Button>
        </Link>
        <Link to="/biens/nouveau">
          <Button variant="outline" className="gap-1.5 w-full sm:w-auto">
            <Building2 className="w-4 h-4" />
            Ajouter mon premier bien
          </Button>
        </Link>
        <Button
          variant="outline"
          className="gap-1.5 w-full sm:w-auto"
          onClick={handleSeed}
          disabled={seeding}
        >
          {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {seeding ? 'Chargement…' : 'Charger un jeu de données de démo'}
        </Button>
      </div>
    </div>
  );
}