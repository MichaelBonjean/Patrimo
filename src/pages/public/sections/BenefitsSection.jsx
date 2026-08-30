import React from 'react';
import { Clock, FileCheck, Calculator, FileText } from 'lucide-react';

const GAINS = [
  {
    icon: Clock,
    big: '−8h/mois',
    title: 'de gestion administrative',
    source: 'Chiffre approximatif, à mesurer avec nos premiers clients puis remplacé par une vraie moyenne.',
  },
  {
    icon: FileCheck,
    big: '0',
    title: 'quittance oubliée',
    source: 'Génération automatique de chaque quittance en 1 clic, pilotée par le compte locataire réel.',
  },
  {
    icon: Calculator,
    big: '12 h',
    title: 'gagnées lors de la déclaration fiscale',
    source: "Calcul via le simulateur d'investissement et le rapport fiscal pré-rempli.",
  },
  {
    icon: FileText,
    big: 'Compris',
    title: 'Votre banquier va enfin comprendre votre patrimoine',
    source: 'Rapport PDF patrimoine sobre, A4, prêt pour une demande de crédit.',
  },
];

export default function BenefitsSection() {
  return (
    <section className="max-w-6xl mx-auto px-5 py-16 sm:py-20">
      <div className="max-w-2xl mb-10">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Résultats</span>
        <h2 className="font-display font-semibold text-2xl sm:text-3xl mt-2 tracking-tight">Ce que vous gagnez</h2>
        <p className="mt-3 text-muted-foreground text-[15px]">
          Des gains chiffrés et concrets — pas de promesses vagues.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {GAINS.map((g) => (
          <div key={g.title} className="rounded-2xl border border-sidebar-border bg-card p-6 hover:border-primary/30 transition-colors">
            <div className="flex items-start gap-4">
              <span className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <g.icon className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <div className="font-display font-semibold text-3xl text-foreground leading-none">{g.big}</div>
                <h3 className="mt-1.5 text-[15px] font-semibold">{g.title}</h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{g.source}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}