import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Monogram } from '../hero/Monogram';
import { base44 } from '@/api/base44Client';

export default function FinalCta() {
  const start = () => base44.auth.redirectToLogin('/onboarding');
  return (
    <section className="border-t border-sidebar-border bg-primary text-primary-foreground">
      <div className="max-w-4xl mx-auto px-5 py-16 sm:py-20 text-center">
        <div className="flex justify-center mb-6 [&_*]:!text-primary-foreground">
          <Monogram />
        </div>
        <h2 className="font-display font-semibold text-3xl sm:text-4xl tracking-tight">
          Reprenez la main. Dès aujourd'hui.
        </h2>
        <p className="mt-3 text-primary-foreground/80 text-[15px] max-w-xl mx-auto">
          Centralisez vos loyers, quittances, fiscalité et SCI dans une seule interface.
        </p>

        <button
          onClick={start}
          className="mt-7 h-11 px-6 rounded-lg bg-primary-foreground text-primary text-sm font-semibold inline-flex items-center gap-2 hover:bg-primary-foreground/90 transition-colors shadow"
        >
          Créer mon compte gratuit <ArrowRight className="w-4 h-4" />
        </button>
        <p className="mt-3 text-xs text-primary-foreground/70">
          Sans carte bancaire · 14 jours d'essai · Résiliation en 1 clic
        </p>
      </div>
    </section>
  );
}