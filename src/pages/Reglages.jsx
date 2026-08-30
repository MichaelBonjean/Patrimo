import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { SlidersHorizontal, Building2, UserCog, FolderArchive, Wrench, ShieldCheck, Lock, CreditCard } from 'lucide-react';
import AccountPreferences from '@/components/reglages/AccountPreferences';
import BillingSettings from '@/pages/BillingSettings';
import { useFeatureFlags } from '@/lib/featureFlags';
import LockedPanel, { LockBadge } from '@/components/FeatureLock';
import AdvancedTools from '@/components/reglages/AdvancedTools';
import SecurityCompliance from '@/components/reglages/SecurityCompliance';
import HoldersSettings from '@/components/settings/HoldersSettings';

const Team = lazy(() => import('@/pages/Team'));
const Documents = lazy(() => import('@/pages/Documents'));

const Fallback = () => (
  <div className="flex items-center justify-center h-40">
    <div className="w-7 h-7 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

// Map une `section` d'URL (dont les anciennes clés des redirections) vers l'id de section accordion.
const PARAM_TO_SECTION = {
  compte: 'compte', detenteurs: 'detenteurs', equipe: 'equipe', documents: 'documents',
  outils: 'outils', securite: 'securite', facturation: 'facturation',
  audit: 'securite', impots: 'outils', simulateur: 'outils', analyse: 'outils',
};

const SECTIONS = [
  { key: 'compte', title: 'Préférences du compte', desc: 'Profil, langue, notifications et données de démonstration.', icon: SlidersHorizontal, content: <AccountPreferences /> },
  { key: 'facturation', title: 'Facturation & abonnement', desc: 'Votre plan, l\u2019essai, la facturation Stripe et le portail client.', icon: CreditCard, content: <BillingSettings /> },
  { key: 'detenteurs', title: 'Détenteurs & structures', desc: 'SCI, sociétés et personnes physiques de votre patrimoine.', icon: Building2, feature: 'sci_holders', content: <HoldersSettings /> },
  { key: 'equipe', title: 'Équipe & rôles', desc: 'Invitez, corrigez les rôles et révoquez les accès de vos collaborateurs.', icon: UserCog, content: <Suspense fallback={<Fallback />}><Team /></Suspense> },
  { key: 'documents', title: 'Coffre documentaire', desc: 'Tous vos documents classés et rapprochés (vue expert).', icon: FolderArchive, content: <Suspense fallback={<Fallback />}><Documents /></Suspense> },
  { key: 'outils', title: 'Outils avancés', desc: 'Simulateur, fiscalité, analyse patrimoine et import massif depuis Excel.', icon: Wrench, content: <AdvancedTools /> },
  { key: 'securite', title: 'Sécurité & conformité', desc: 'Journal d\u2019audit, export RGPD, signalement de bug et zone dangereuse.', icon: ShieldCheck, content: <SecurityCompliance /> },
];

export default function Reglages() {
  const [params] = useSearchParams();
  const requested = PARAM_TO_SECTION[params.get('section')] || 'compte';
  const [open, setOpen] = useState(['compte', requested].filter((v, i, a) => a.indexOf(v) === i));
  const { isUnlocked, flags } = useFeatureFlags();

  // Ouvre automatiquement la section demandée par l'URL (post-redirect).
  useEffect(() => {
    setOpen((prev) => (prev.includes(requested) ? prev : [...prev, requested]));
  }, [requested]);

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Réglages</h1>
        <p className="text-sm text-muted-foreground mt-1">Configurez votre compte, vos structures et vos outils.</p>
      </div>

      <Accordion type="multiple" value={open} onValueChange={setOpen} className="rounded-2xl border border-border bg-card overflow-hidden">
        {SECTIONS.map((s, idx) => {
          const locked = s.feature ? !isUnlocked(s.feature) : false;
          const lockInfo = locked && s.feature ? flags[s.feature] : null;
          return (
          <AccordionItem key={s.key} value={s.key} className={`px-5 md:px-6 ${idx === SECTIONS.length - 1 ? 'border-b-0' : ''}`}>
            <AccordionTrigger className="py-5 hover:no-underline">
              <div className="flex items-start gap-3.5 flex-1 min-w-0 pr-2">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${locked ? 'bg-muted' : 'bg-primary/10'}`}>
                  {locked ? <Lock className="w-5 h-5 text-muted-foreground" /> : <s.icon className="w-5 h-5 text-primary" />}
                </div>
                <div className="text-left min-w-0">
                  <p className="font-semibold text-sm text-foreground flex items-center gap-2 flex-wrap">
                    {s.title}
                    {lockInfo && <LockBadge unlockText={lockInfo.unlockText} />}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{s.desc}</p>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-2">
              {locked && lockInfo
                ? <LockedPanel title={s.title} desc={lockInfo.reason ? `Verrouillé — ${lockInfo.reason}` : s.desc} unlockText={lockInfo.unlockText} icon={s.icon} />
                : s.content}
            </AccordionContent>
          </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}