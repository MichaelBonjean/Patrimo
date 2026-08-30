import React, { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import LegalShell from '@/components/legal/LegalShell';
import { Button } from '@/components/ui/button';

// Page publique atteinte via le lien de désactivation contenu dans l'email
// de confirmation de suppression. Invoque cancelAccountDeletion({ token }).
export default function CancelDeletion() {
  const [state, setState] = useState('loading'); // loading | ok | error
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        if (!token) { setState('error'); return; }
        const res = await base44.functions.invoke('cancelAccountDeletion', { token });
        setState(res?.data?.ok ? 'ok' : 'error');
      } catch (e) {
        setState('error');
      }
    })();
  }, []);

  return (
    <LegalShell docKey="mentions" title="Annulation de la suppression de compte">
      {state === 'loading' && (
        <div className="flex items-center gap-2 text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" /> Annulation en cours…</div>
      )}
      {state === 'ok' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="w-5 h-5" /> <strong>Votre demande de suppression a bien été annulée.</strong></div>
          <p>Vos données ne seront pas purgées. Vous pouvez continuer à utiliser Patrimo normalement.</p>
          <Link to="/"><Button>Retour à l\u2019application</Button></Link>
        </div>
      )}
      {state === 'error' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-red-600"><XCircle className="w-5 h-5" /> <strong>Lien invalide ou déjà utilisé.</strong></div>
          <p>Ce lien de désactivation est introuvable, expiré ou a déjà été consommé. Aucune action n\u2019a été effectuée.</p>
          <p>Si vous pensez qu\u2019il s\u2019agit d\u2019une erreur, contactez le support.</p>
          <Link to="/"><Button variant="outline">Retour à l\u2019application</Button></Link>
        </div>
      )}
    </LegalShell>
  );
}