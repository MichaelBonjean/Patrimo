import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Home, Building2, Boxes, Landmark, Users, ArrowLeftRight, CheckCircle2, LayoutDashboard,
  ChevronRight, ChevronLeft, Sparkles, FileSpreadsheet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { computeOnboardingProgress } from '@/lib/onboarding/progress';
import OnboardingProgress from '@/components/onboarding/OnboardingProgress';
import GuidedExcelImporter from '@/components/onboarding/GuidedExcelImporter';
import QuickPropertyForm from '@/components/onboarding/QuickPropertyForm';
import QuickLoanForm from '@/components/onboarding/QuickLoanForm';
import { cn } from '@/lib/utils';

const STEPS = [
  { title: 'Créer mon patrimoine', icon: Home, desc: 'Ajoutez votre premier bien pour démarrer.' },
  { title: 'Importer mes biens', icon: Building2, desc: 'Importez le reste de vos biens depuis Excel.' },
  { title: 'Importer mes lots', icon: Boxes, desc: 'Lots, surfaces, loyers et DPE.' },
  { title: 'Ajouter mes prêts', icon: Landmark, desc: 'Capital, taux et durée des emprunts.' },
  { title: 'Baux & locataires', icon: Users, desc: 'Date d\'effet, loyers, contacts locataires.' },
  { title: 'Importer les transactions', icon: FileSpreadsheet, desc: 'Relevés bancaires ou exports comptables.' },
  { title: 'Vérifier les rapprochements', icon: ArrowLeftRight, desc: 'Contrôlez le rattachement des paiements.' },
  { title: 'Mon premier dashboard', icon: LayoutDashboard, desc: 'Rentabilité, cashflow et alertes en un coup d\'œil.' },
];

export default function Onboarding() {
  const { user } = useAuth();
  const ownerEmail = user?.email || '';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);

  const propsQ = useQuery({
    queryKey: ['onb-properties', ownerEmail],
    queryFn: () => base44.entities.Property.filter({ owner_id: ownerEmail }, '-created_date', 200),
    enabled: !!ownerEmail,
  });
  const lotsQ = useQuery({
    queryKey: ['onb-lots', ownerEmail],
    queryFn: () => base44.entities.Lot.filter({ owner_id: ownerEmail }, '-created_date', 500),
    enabled: !!ownerEmail,
  });
  const leasesQ = useQuery({
    queryKey: ['onb-leases', ownerEmail],
    queryFn: () => base44.entities.Lease.filter({ owner_id: ownerEmail }, '-created_date', 200),
    enabled: !!ownerEmail,
  });
  const txQ = useQuery({
    queryKey: ['onb-transactions', ownerEmail],
    queryFn: () => base44.entities.Transaction.filter({ owner_id: ownerEmail }, '-created_date', 500),
    enabled: !!ownerEmail,
  });

  const properties = propsQ.data || [];
  const lots = lotsQ.data || [];
  const leases = leasesQ.data || [];
  const transactions = txQ.data || [];
  const hasLoan = properties.some((p) => Number(p.loan_amount) > 0);

  const progress = useMemo(
    () => computeOnboardingProgress({ properties, lots, leases, transactions, hasLoan }),
    [properties, lots, leases, transactions, hasLoan]
  );

  const reload = () => qc.invalidateQueries({ queryKey: ['onb-properties'] }) && qc.invalidateQueries({ queryKey: ['onb-lots'] }) && qc.invalidateQueries({ queryKey: ['onb-leases'] }) && qc.invalidateQueries({ queryKey: ['onb-transactions'] });

  const goNext = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const goPrev = () => setStep((s) => Math.max(0, s - 1));
  const jump = (s) => setStep(s);

  const ctx = { properties, lots, leases };
  const Step = STEPS[step];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> Onboarding investisseur
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configurez votre patrimoine étape par étape — vous voyez de la valeur dès le premier bien.
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild className="text-xs">
          <Link to="/">Explorer le dashboard <ChevronRight className="w-3.5 h-3.5" /></Link>
        </Button>
      </div>

      <OnboardingProgress progress={progress} onJump={jump} />

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Stepper vertical */}
        <ol className="space-y-1">
          {STEPS.map((s, i) => {
            const done =
              (i === 0 && properties.length > 0) ||
              (i === 1 && properties.length > 0) ||
              (i === 2 && lots.length > 0) ||
              (i === 3 && hasLoan) ||
              (i === 4 && leases.length > 0) ||
              (i === 5 && transactions.length > 0) ||
              (i === 6 && transactions.length > 0) ||
              (i === 7 && progress.percent === 100);
            const active = i === step;
            const Icon = s.icon;
            return (
              <li key={i}>
                <button
                  onClick={() => jump(i)}
                  className={cn(
                    'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    active ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60 text-foreground'
                  )}
                >
                  <span className={cn('shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs', done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                    {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-3.5 h-3.5" />}
                  </span>
                  <span className={cn('text-xs', active && 'font-medium')}>{s.title}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Contenu */}
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10"><Step.icon className="w-4 h-4 text-primary" /></div>
            <div>
              <p className="text-sm font-semibold">{Step.title}</p>
              <p className="text-xs text-muted-foreground">{Step.desc}</p>
            </div>
          </div>

          {step === 0 && (
            <div className="space-y-4">
              {properties.length === 0 ? (
                <QuickPropertyForm ownerEmail={ownerEmail} onCreated={() => reload()} />
              ) : (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
                  Votre premier bien « {properties[0].name} » est créé. Passez à l'import des biens restants.
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <GuidedExcelImporter entityType="property" ownerEmail={ownerEmail} ctx={ctx} onImported={() => reload()} />
          )}
          {step === 2 && (
            properties.length
              ? <GuidedExcelImporter entityType="lot" ownerEmail={ownerEmail} ctx={ctx} onImported={() => reload()} />
              : <p className="text-sm text-muted-foreground">Créez d'abord un bien (étape 1) avant d'y importer des lots.</p>
          )}
          {step === 3 && (
            <QuickLoanForm properties={properties} ownerEmail={ownerEmail} onSaved={() => reload()} />
          )}
          {step === 4 && (
            properties.length && lots.length
              ? <GuidedExcelImporter entityType="lease" ownerEmail={ownerEmail} ctx={ctx} onImported={() => reload()} />
              : <p className="text-sm text-muted-foreground">Ajoutez d'abord des lots (étape 3) pour y associer des baux.</p>
          )}

          {step === 5 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Importez vos relevés bancaires ou exports comptables via l'assistant dédié. Il détecte le format (CSV, CAF, saisie manuelle), catégorise et rattache chaque ligne à un bien.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild><Link to="/import">Ouvrir l'assistant d'import</Link></Button>
                {transactions.length > 0 && <Badge variant="secondary" className="text-xs self-center">{transactions.length} transactions déjà importées</Badge>}
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Vérifiez que chaque paiement est correctement rattaché à une échéance de loyer. L'écran de rapprochement liste les opérations en attente.
              </p>
              <Button asChild variant="outline"><Link to="/import">Vérifier les rapprochements</Link></Button>
            </div>
          )}

          {step === 7 && (
            <div className="space-y-3 text-center py-6">
              <div className="w-14 h-14 rounded-full bg-emerald-100 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-emerald-600" />
              </div>
              <p className="text-sm font-medium">Votre patrimoine est configuré à {progress.percent}%</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Le dashboard consolide rentabilité, cashflow, fiscalité et alertes. Vous pouvez compléter les étapes restantes plus tard.
              </p>
              <Button asChild className="gap-1.5"><Link to="/"><LayoutDashboard className="w-4 h-4" /> Ouvrir mon dashboard</Link></Button>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-4 border-t border-border">
            <Button variant="ghost" size="sm" onClick={goPrev} disabled={step === 0} className="gap-1">
              <ChevronLeft className="w-4 h-4" /> Précédent
            </Button>
            <span className="text-xs text-muted-foreground">Étape {step + 1} / {STEPS.length}</span>
            {step < STEPS.length - 1 ? (
              <Button size="sm" onClick={goNext} className="gap-1">Suivant <ChevronRight className="w-4 h-4" /></Button>
            ) : (
              <Button size="sm" onClick={() => navigate('/')} className="gap-1">Terminer <CheckCircle2 className="w-4 h-4" /></Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}