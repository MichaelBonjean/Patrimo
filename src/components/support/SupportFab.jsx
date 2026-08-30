import React, { useEffect, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import SupportSheet from './SupportSheet';

// Bouton flottant "Support" — discret, en bas à droite.
// Se cache quand le QuickActionsFab est ouvert (signal window 'qa-fab-open').
export default function SupportFab() {
  const [open, setOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);

  useEffect(() => {
    const handler = (e) => setQaOpen(!!e.detail);
    window.addEventListener('qa-fab-open', handler);
    return () => window.removeEventListener('qa-fab-open', handler);
  }, []);

  if (qaOpen) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Support"
        onClick={() => setOpen(true)}
        className="fixed bottom-40 right-4 md:bottom-6 md:right-6 z-40 h-11 px-4 rounded-full bg-card border border-border shadow-md text-foreground hover:border-primary/40 hover:shadow-lg flex items-center gap-2 transition-all"
      >
        <LifeBuoy className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium hidden sm:inline">Support</span>
      </button>
      <SupportSheet open={open} onOpenChange={setOpen} />
    </>
  );
}