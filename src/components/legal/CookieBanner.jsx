import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Bandeau cookies "essentiels uniquement" : aucun tracker n'est déposé,
// on se contente d'informer l'utilisateur et de mémoriser son ack.
export default function CookieBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem('patrimo-cookie-ack')) setOpen(true);
  }, []);
  const dismiss = () => { localStorage.setItem('patrimo-cookie-ack', '1'); setOpen(false); };
  if (!open) return null;
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur px-4 py-3 shadow-lg">
      <div className="max-w-5xl mx-auto flex items-center gap-3 text-xs sm:text-sm">
        <p className="flex-1 text-muted-foreground">
          Notre site n'utilise que des <strong>cookies techniques essentiels</strong> au fonctionnement
          (session, préférences d'affichage). Aucun cookie de suivi publicitaire ou de profilage n'est déposé.{' '}
          <Link to="/confidentialite" className="underline hover:text-foreground">En savoir plus</Link>.
        </p>
        <Button size="sm" onClick={dismiss}>Compris</Button>
        <button onClick={dismiss} aria-label="Fermer" className="p-1 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
    </div>
  );
}