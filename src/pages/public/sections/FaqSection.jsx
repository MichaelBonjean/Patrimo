import React from 'react';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { ShieldCheck, XCircle, FileSpreadsheet, Lock, Gift, Smartphone } from 'lucide-react';

const FAQ = [
  {
    icon: ShieldCheck,
    q: 'Mes données sont-elles en sécurité ?',
    a: "Hébergement européen, chiffrement en transit (TLS) et au repos, conformité RGPD et DPA (Data Processing Agreement) disponible sur demande. Vos données ne sont jamais revendues.",
  },
  {
    icon: XCircle,
    q: 'Je peux résilier quand ?',
    a: "À tout moment, prorata temporis pour les abonnements payants. Vous pouvez exporter l'intégralité de vos données (CSV / PDF) avant votre départ en un clic.",
  },
  {
    icon: FileSpreadsheet,
    q: 'Comment je migre depuis Excel ?',
    a: "Un guide d'import pas-à-pas (CSV, relevés bancaires, registre loyers) est intégré, avec assistance téléphonique gratuite pendant les 3 premiers jours pour vous accompagner dans la reprise de votre historique.",
  },
  {
    icon: Lock,
    q: 'Suis-je le seul à voir mes données ?',
    a: "Oui. L'isolation multi-tenant est testée automatiquement (RLS par bailleur) avec un RBAC strict : un autre utilisateur ne peut ni lire ni modifier vos biens, bails ou transactions.",
  },
  {
    icon: Gift,
    q: 'Puis-je essayer avant de payer ?',
    a: "14 jours d'essai complet, sans carte bancaire et sans engagement. Une fois l'essai terminé, vos données restent accessibles en export.",
  },
  {
    icon: Smartphone,
    q: 'Y a-t-il une app mobile ?',
    a: "Patrimo est une PWA installable : ajoutez-la à votre écran d'accueil depuis votre navigateur pour un usage mobile natif, notifications et raccourcis inclus.",
  },
];

export default function FaqSection() {
  return (
    <section className="max-w-3xl mx-auto px-5 py-16 sm:py-20">
      <div className="mb-8">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Objections</span>
        <h2 className="font-display font-semibold text-2xl sm:text-3xl mt-2 tracking-tight">Vos questions, nos réponses</h2>
      </div>

      <Accordion type="single" collapsible className="w-full divide-y divide-sidebar-border rounded-2xl border border-sidebar-border overflow-hidden bg-card">
        {FAQ.map((item) => (
          <AccordionItem key={item.q} value={item.q} className="px-5">
            <AccordionTrigger className="hover:no-underline py-5 text-left">
              <span className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <item.icon className="w-4 h-4" />
                </span>
                <span className="font-semibold text-[15px]">{item.q}</span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground text-[14px] leading-relaxed pb-5 pl-10">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}