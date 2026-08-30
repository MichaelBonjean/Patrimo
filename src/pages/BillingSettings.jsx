import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Settings, Star, Loader2, Sparkles, Download, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useOwnerFilter } from '@/lib/tenantFilter';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  getEffectivePlan, PLAN_LABELS, PLAN_LIMITS, getPropertyLimit, trialDaysLeft,
} from '@/lib/planGate';

const STATUS_LABEL = {
  none: 'Aucun abonnement', trialing: 'En essai', active: 'Actif',
  past_due: 'Paiement en souffrance', canceled: 'Annulé (fin de période)', ended: 'Terminé',
};
const STATUS_VARIANT = {
  none: 'secondary', trialing: 'secondary', active: 'default',
  past_due: 'destructive', canceled: 'outline', ended: 'secondary',
};
const NEXT_PLAN = { starter: 'pro', pro: 'business', business: null };

// Entités exportées par le portage de données (art. 20 RGPD).
const EXPORT_ENTITIES = [
  'Property', 'Lot', 'Lease', 'RentDue', 'Payment', 'Transaction', 'BankTransaction',
  'BankImport', 'Impaye', 'Quittance', 'Document', 'Alert', 'RentRevision',
  'ChargeRegularization', 'MonthClose', 'Holder', 'HolderMember', 'PropertyHolder',
  'TenantAccess', 'Incident', 'Subscription', 'InvestmentScenario',
];

export default function BillingSettings() {
  const navigate = useNavigate();
  const { withOwner } = useOwnerFilter();
  const [user, setUser] = useState(null);
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [managing, setManaging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delText, setDelText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const me = await base44.auth.me();
        setUser(me);
        const subs = await base44.entities.Subscription.list();
        setSub((subs && subs[0]) || null);
      } catch (e) {
        toast.error(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const manage = async () => {
    setManaging(true);
    try {
      const res = await base44.functions.invoke('createPortalSession', {});
      const url = res?.data?.url;
      if (url) window.location.href = url;
      else toast.error(res?.data?.error || 'Aucun abonnement à gérer.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setManaging(false);
    }
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const out = { _user: { id: user?.id, email: user?.email, plan: user?.plan }, _exported_at: new Date().toISOString() };
      for (const e of EXPORT_ENTITIES) {
        try { out[e] = await base44.entities[e].filter(withOwner()); }
        catch (_) { out[e] = []; }
      }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `patrimo-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('Export téléchargé (JSON).');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setExporting(false);
    }
  };

  const requestDeletion = async () => {
    if (delText.trim() !== 'Supprimer mon compte') {
      toast.error('Saisissez exactement « Supprimer mon compte » pour confirmer.');
      return;
    }
    setDeleting(true);
    try {
      const res = await base44.functions.invoke('requestAccountDeletion', {});
      if (res?.data?.ok) {
        toast.success('Demande enregistrée. Un email de confirmation vous a été envoyé.');
        setUser({ ...user, pending_deletion: { status: 'pending', scheduled_at: res.data.scheduled_at } });
        setDelOpen(false);
        setDelText('');
      } else {
        toast.error(res?.data?.error || 'Erreur');
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const plan = getEffectivePlan(user);
  const planLabel = PLAN_LABELS[plan];
  const limit = getPropertyLimit(user);
  const status = user?.subscription_status || 'none';
  const daysLeft = trialDaysLeft(user);
  const hasStripe = !!(user?.stripe_customer_id || sub?.stripe_customer_id);
  const next = NEXT_PLAN[plan];
  const pending = user?.pending_deletion;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Facturation & abonnement</h1>
        <p className="text-sm text-muted-foreground mt-1">Gérez votre plan, votre essai et vos paiements.</p>
      </div>

      {/* Suppression en cours */}
      {pending?.status === 'pending' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" /> Suppression programmée</div>
          <p className="mt-1">
            Votre demande de suppression est enregistrée. Vos données seront définitivement purgées le{' '}
            <strong>{new Date(pending.scheduled_at).toLocaleDateString('fr-FR')}</strong>. Un email contenant un lien
            d'annulation vous a été envoyé.
          </p>
        </div>
      )}

      {/* Plan actuel */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Plan actuel</p>
            <div className="flex items-center gap-2 mt-1">
              <Star className="w-5 h-5 text-accent" />
              <span className="font-display text-2xl font-semibold">{planLabel}</span>
              <Badge variant={STATUS_VARIANT[status] || 'secondary'}>{STATUS_LABEL[status] || status}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {limit === Infinity ? 'Biens illimités' : `${limit} bien${limit > 1 ? 's' : ''} inclus`}
              {' · '}{(PLAN_LIMITS[plan].features).length} fonctionnalités avancées
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => navigate('/pricing')}>
              <Sparkles className="w-4 h-4" /> Changer de plan
            </Button>
            <Button className="gap-2" disabled={!hasStripe || managing} onClick={manage}>
              {managing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              Gérer mon abonnement
            </Button>
          </div>
        </div>

        {daysLeft > 0 && (
          <div className="mt-4 rounded-lg bg-accent/10 border border-accent/20 p-3 text-xs">
            <Sparkles className="w-3.5 h-3.5 inline mr-1.5 text-accent" />
            Essai gratuit — il vous reste <strong>{daysLeft} jour{daysLeft > 1 ? 's' : ''}</strong>. {daysLeft <= 3 && 'Mettez à niveau pour conserver vos accès.'}
          </div>
        )}
        {status === 'past_due' && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800">
            Un paiement a échoué. Régularisez via « Gérer mon abonnement » — sans règlement sous 7 jours, votre compte repassera en Starter.
          </div>
        )}
      </div>

      {/* Détails Stripe */}
      {sub && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Settings className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Détails de l'abonnement</h2>
          </div>
          <dl className="text-sm space-y-1.5">
            <div className="flex justify-between"><dt className="text-muted-foreground">Plan</dt><dd>{PLAN_LABELS[sub.plan]}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Statut Stripe</dt><dd><Badge variant={STATUS_VARIANT[sub.status] || 'secondary'}>{STATUS_LABEL[sub.status] || sub.status}</Badge></dd></div>
            {sub.current_period_end && (
              <div className="flex justify-between"><dt className="text-muted-foreground">Fin de période</dt><dd>{new Date(sub.current_period_end).toLocaleDateString('fr-FR')}</dd></div>
            )}
            {sub.cancel_at && (
              <div className="flex justify-between"><dt className="text-muted-foreground">Annulation prévue</dt><dd>{new Date(sub.cancel_at).toLocaleDateString('fr-FR')}</dd></div>
            )}
          </dl>
        </div>
      )}

      {/* Données & confidentialité (RGPD art. 15/17/20) */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold text-sm mb-1">Données & confidentialité</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Conformément au RGPD, exportez l'intégralité de vos données ou demandez la suppression de votre compte.
          Voir la <Link to="/confidentialite" className="underline">politique de confidentialité</Link>.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={exportData} disabled={exporting || pending?.status === 'pending'}>
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Télécharger toutes mes données
          </Button>
          <Button variant="destructive" className="gap-2" onClick={() => setDelOpen(true)} disabled={pending?.status === 'pending'}>
            <Trash2 className="w-4 h-4" /> Supprimer mon compte
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Les paiements sont sécurisés par Stripe. Annulez à tout moment depuis le portail client.
      </p>

      {/* Dialogue suppression */}
      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer mon compte</DialogTitle>
            <DialogDescription>
              Cette action ouvre un délai de rétention de 30 jours. Un email de confirmation vous sera envoyé
              avec un lien d'annulation. À l'issue du délai, l'intégralité de vos données sera définitivement purgée.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>Pour confirmer, saisissez exactement :</p>
            <p className="font-mono bg-muted px-2 py-1 rounded text-center">Supprimer mon compte</p>
            <input
              value={delText}
              onChange={(e) => setDelText(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Confirmation…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDelOpen(false); setDelText(''); }}>Annuler</Button>
            <Button variant="destructive" onClick={requestDeletion} disabled={deleting || delText.trim() !== 'Supprimer mon compte'}>
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Confirmer la suppression
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}