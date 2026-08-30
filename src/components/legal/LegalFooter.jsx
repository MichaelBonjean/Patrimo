import React from 'react';
import { Link } from 'react-router-dom';
import StatusWidget from '@/components/support/StatusWidget';

// Pied de page légal minimal intégré à l'app authentifiée (desktop).
export default function LegalFooter() {
  return (
    <footer className="hidden md:block border-t border-border bg-card">
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/70">Patrimo</span>
        <StatusWidget />
        <span className="text-muted-foreground/30">·</span>
        <Link to="/aide" className="hover:text-foreground">Aide</Link>
        <Link to="/statut" className="hover:text-foreground">État des services</Link>
        <Link to="/a-propos" className="hover:text-foreground">À propos</Link>
        <span className="text-muted-foreground/30">·</span>
        <Link to="/cgu" className="hover:text-foreground">CGU</Link>
        <Link to="/mentions-legales" className="hover:text-foreground">Mentions légales</Link>
        <Link to="/confidentialite" className="hover:text-foreground">Confidentialité</Link>
        <Link to="/dpa" className="hover:text-foreground">Sous-traitance (DPA)</Link>
      </div>
    </footer>
  );
}