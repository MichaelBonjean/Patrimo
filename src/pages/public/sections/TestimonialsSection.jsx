import React from 'react';
import { Users } from 'lucide-react';

export default function TestimonialsSection() {
  return (
    <section className="border-y border-sidebar-border bg-secondary/30">
      <div className="max-w-6xl mx-auto px-5 py-16 sm:py-20">
        <div className="max-w-2xl mb-10">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Témoignages</span>
          <h2 className="font-display font-semibold text-2xl sm:text-3xl mt-2 tracking-tight">Ce que disent nos clients</h2>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-dashed border-sidebar-border bg-card/60 p-6 text-center flex flex-col items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                <Users className="w-5 h-5" />
              </span>
              <p className="font-display font-semibold text-lg">Bientôt disponible</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Nos premiers utilisateurs témoigneront ici dès qu'ils auront quelques semaines de vrai recul.
              </p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground max-w-2xl mx-auto">
          Nous préférons attendre des retours vérifiables de nos 5 premiers clients payants
          plutôt que d'afficher de faux témoignages — qui détruiraient votre confiance le jour où ils seraient détectés.
        </p>
      </div>
    </section>
  );
}