import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { Loader2, ChevronLeft, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { computeLeaseStatus } from '@/lib/lease';
import { logAudit } from '@/lib/patrimony';
import StepContext from '@/components/bienvenue/StepContext';
import StepStructure from '@/components/bienvenue/StepStructure';
import StepPremierBien from '@/components/bienvenue/StepPremierBien';
import StepLocataire from '@/components/bienvenue/StepLocataire';
import StepNotifications from '@/components/bienvenue/StepNotifications';

const PALETTE = ['#16305C', '#E8B23A', '#22c55e', '#0ea5e9'];

function addYears(dateStr, years) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (years) d.setFullYear(d.getFullYear() + Number(years));
  return d.toISOString().slice(0, 10);
}

export default function Bienvenue() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ownerEmail = user?.email || '';

  const [w, setW] = useState({
    context: null,
    structure: null,
    bien: null,
    locataire: null,
    notif: { notify_impayes: true, notify_quittances: true },
    holderId: null,
    propertyId: null,
    busy: false,
  });
  const setField = (k, v) => setW((p) => ({ ...p, [k]: v }));

  // Suite d'étapes dynamique selon le contexte
  const steps = useMemo(() => {
    const arr = [{ key: 'context', label: 'Contexte' }];
    if (w.context === 'sci' || w.context === 'mix') arr.push({ key: 'structure', label: 'Structure' });
    arr.push({ key: 'bien', label: '1er bien' });
    arr.push({ key: 'locataire', label: 'Locataire' });
    arr.push({ key: 'notifications', label: 'Préférences' });
    return arr;
  }, [w.context]);

  const [i, setI] = useState(0);
  const cur = steps[i];

  const goPrev = () => setI((x) => Math.max(0, x - 1));

  // Validations / créations par étape — soulève une erreur en cas d'échec (catch global -> toast)
  const advanceFrom = async (key) => {
    if (key === 'context') {
      if (!w.context) throw new Error('Choisissez une option pour continuer');
      return;
    }
    if (key === 'structure') {
      const v = w.structure || {};
      if (!v.denomination?.trim()) throw new Error('Renseignez la dénomination sociale');
      if (w.holderId) return; // déjà créé (retour arrière)
      setField('busy', true);
      const sci = await base44.entities.Holder.create({
        owner_id: ownerEmail,
        name: v.denomination.trim(),
        type: 'SCI',
        is_demo: false,
      });
      // Un Holder personne physique par associé + membre de la SCI
      for (const a of (v.associates || [])) {
        if (!a.name?.trim()) continue;
        const person = await base44.entities.Holder.create({
          owner_id: ownerEmail,
          name: a.name.trim(),
          type: 'Personne physique',
          is_demo: false,
        });
        await base44.entities.HolderMember.create({
          owner_id: ownerEmail,
          parent_holder_id: sci.id,
          member_holder_id: person.id,
          share_percent: a.share ? Number(a.share) : null,
          quality: 'associe',
          demembrement: 'pleine_propriete',
          entry_date: new Date().toISOString().slice(0, 10),
        });
      }
      setField('holderId', sci.id);
      await qc.invalidateQueries({ queryKey: ['holders'] });
      logAudit({ action: 'create', entity_type: 'Holder', entity_id: sci.id, entity_label: sci.name, details: { source: 'wizard_bienvenue' } });
      toast.success('Structure ajoutée 🏛️');
      return;
    }
    if (key === 'bien') {
      const v = w.bien || {};
      if (v.mode === 'photo') return; // finalisation gérée plus loin
      if (v.mode === 'form') {
        if (!v.name?.trim()) throw new Error('Donnez un nom à votre bien');
        if (w.propertyId) return; // déjà créé (retour arrière)
        setField('busy', true);
        const holding = w.context === 'sci' ? 'SCI' : w.context === 'mix' ? 'En propre' : 'En propre';
        const rec = await base44.entities.Property.create({
          owner_id: ownerEmail,
          name: v.name.trim(),
          category: 'Appartement',
          holding_structure: holding,
          tax_regime: 'Location nue (revenus fonciers)',
          address: v.address?.trim() || undefined,
          acquisition_date: new Date().toISOString().slice(0, 10),
        });
        setField('propertyId', rec.id);
        await qc.invalidateQueries({ queryKey: ['onb-properties'] });
        logAudit({ action: 'create', entity_type: 'Property', entity_id: rec.id, entity_label: rec.name, details: { source: 'wizard_bienvenue' } });
        toast.success('Bien créé 🏠');
        return;
      }
      throw new Error('Choisissez une option pour votre premier bien');
    }
    if (key === 'locataire') {
      const v = w.locataire || {};
      if (v.mode === 'vacant' || !v.mode) return;
      if (!v.tenant_name?.trim()) throw new Error('Renseignez le nom du locataire (ou passez l\'étape)');
      if (!w.propertyId) throw new Error('Ajoutez d\'abord un bien (étape précédente)');
      if (w.locataire._done) return;
      setField('busy', true);
      const rent = v.rent ? Number(v.rent) : null;
      const dateStart = v.entry_date || new Date().toISOString().slice(0, 10);
      const dateEnd = addYears(dateStart, v.duration);
      const lot = await base44.entities.Lot.create({
        owner_id: ownerEmail,
        property_id: w.propertyId,
        designation: 'Logement',
        lease_type: v.mode === 'meuble' ? 'Meublé' : 'Vide-Nu',
        furnished: v.mode === 'meuble',
        rent_excluding_charges: rent,
        is_vacant: false,
        tenants: [{ id: crypto.randomUUID(), name: v.tenant_name.trim(), entry_date: dateStart, exit_date: dateEnd || '', email: '', phone: '' }],
      });
      const lease = await base44.entities.Lease.create({
        owner_id: ownerEmail,
        property_id: w.propertyId,
        lot_id: lot.id,
        lease_type: v.mode === 'meuble' ? 'Meublé' : 'Vide-Nu',
        date_start: dateStart,
        date_end: dateEnd,
        status: computeLeaseStatus({ date_start: dateStart, date_end: dateEnd, status: 'actif' }),
        tenants: [{ id: crypto.randomUUID(), name: v.tenant_name.trim(), entry_date: dateStart, exit_date: dateEnd || '', email: '', phone: '' }],
        rent_excluding_charges: rent,
        charges: 0,
        due_day: 5,
        payment_frequency: 'mensuel',
        indexation_type: 'aucune',
        furnished: v.mode === 'meuble',
      });
      setField('locataire', { ...v, _done: true, _lotId: lot.id, _leaseId: lease.id });
      await qc.invalidateQueries({ queryKey: ['onb-leases'] });
      await qc.invalidateQueries({ queryKey: ['onb-lots'] });
      logAudit({ action: 'create', entity_type: 'Lease', entity_id: lease.id, entity_label: v.tenant_name, details: { source: 'wizard_bienvenue' } });
      toast.success('Locataire enregistré 🔑');
      return;
    }
  };

  const persistAndFinish = async (redirect = '/') => {
    const onb = {
      completed: true,
      mode_expert: false,
      context: w.context,
      notify_impayes: w.notif.notify_impayes,
      notify_quittances: w.notif.notify_quittances,
      completed_at: new Date().toISOString(),
    };
    try {
      await base44.auth.updateMe({ onboarding: onb });
    } catch {
      // non bloquant — on valide quand même la session
    }
    try {
      confetti({ particleCount: 90, spread: 80, origin: { y: 0.6 }, colors: PALETTE });
    } catch { /* noop */ }
    toast.success('🎉 Patrimo est prêt. Vous pouvez ajouter d\'autres biens depuis l\'accueil.');
    await qc.invalidateQueries();
    navigate(redirect);
  };

  const handleNext = async () => {
    if (w.busy) return;
    setField('busy', true);
    try {
      await advanceFrom(cur.key);
      // Le mode photo du 1er bien finalise vers l'import de documents.
      if (cur.key === 'bien' && w.bien?.mode === 'photo') {
        await persistAndFinish('/import');
        return;
      }
      if (cur.key === 'notifications') {
        await persistAndFinish('/');
        return;
      }
      if (i < steps.length - 1) setI((x) => x + 1);
    } catch (e) {
      toast.error(e?.message || 'Une erreur est survenue');
    } finally {
      setField('busy', false);
    }
  };

  // Saut vers le mode expert (désactive le wizard pour cet utilisateur)
  const goExpert = async () => {
    try {
      await base44.auth.updateMe({ onboarding: { completed: true, mode_expert: true } });
    } catch { /* non bloquant */ }
    navigate('/');
  };

  const isLast = i === steps.length - 1;
  const nextLabel = cur.key === 'bien' && w.bien?.mode === 'photo' ? "Aller à l'import" : isLast ? 'Terminer' : 'Continuer';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-4 sm:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-display font-semibold">P</span>
          <span className="font-semibold tracking-tight">Bienvenue sur Patrimo</span>
        </div>
        <button onClick={goExpert} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 min-h-[44px] px-2">
          <Zap className="w-3.5 h-3.5" /> Mode expert
        </button>
      </header>

      {/* Progress */}
      <div className="px-4 sm:px-6 pb-2">
        <div className="flex items-center gap-1.5">
          {steps.map((s, idx) => (
            <span
              key={s.key}
              className={`h-1.5 flex-1 rounded-full transition-colors ${idx <= i ? 'bg-primary' : 'bg-muted'}`}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">Étape {i + 1} / {steps.length} · {cur.label}</p>
      </div>

      {/* Contenu — une question par écran */}
      <main className="flex-1 px-4 sm:px-6 py-4 overflow-y-auto">
        <div className="max-w-md mx-auto space-y-4">
          <h1 className="text-2xl font-display font-semibold tracking-tight">
            {cur.key === 'context' && 'Que possédez-vous aujourd\'hui ?'}
            {cur.key === 'structure' && 'Dites-nous en plus sur votre structure'}
            {cur.key === 'bien' && 'Ajoutons votre premier bien'}
            {cur.key === 'locataire' && 'Ce bien est-il loué ?'}
            {cur.key === 'notifications' && 'Comment voulez-vous être prévenu ?'}
          </h1>

          {cur.key === 'context' && <StepContext value={w.context} onSelect={(k) => setField('context', k)} />}
          {cur.key === 'structure' && <StepStructure value={w.structure} onChange={(v) => setField('structure', v)} />}
          {cur.key === 'bien' && <StepPremierBien value={w.bien} onChange={(v) => setField('bien', v)} />}
          {cur.key === 'locataire' && <StepLocataire value={w.locataire} onChange={(v) => setField('locataire', v)} />}
          {cur.key === 'notifications' && <StepNotifications value={w.notif} onChange={(v) => setField('notif', v)} />}
        </div>
      </main>

      {/* Footer fixe — Précédent / Suivant */}
      <footer className="sticky bottom-0 bg-background/95 backdrop-blur border-t border-border px-4 sm:px-6 py-3">
        <div className="max-w-md mx-auto flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={goPrev} disabled={i === 0 || w.busy} className="gap-1 min-h-[44px]">
            <ChevronLeft className="w-4 h-4" /> Précédent
          </Button>
          <Button onClick={handleNext} disabled={w.busy} className="gap-1.5 min-h-[44px] px-5">
            {w.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : isLast ? <Sparkles className="w-4 h-4" /> : null}
            {nextLabel}
          </Button>
        </div>
      </footer>
    </div>
  );
}