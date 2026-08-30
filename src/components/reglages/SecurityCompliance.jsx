import React, { lazy, Suspense, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { ScrollText, Download, Bug, AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { useFeatureFlags } from '@/lib/featureFlags';
import LockedPanel from '@/components/FeatureLock';

const AuditLog = lazy(() => import('@/pages/AuditLog'));
const Fallback = () => (
  <div className="flex items-center justify-center h-40">
    <div className="w-7 h-7 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

const GDPR_ENTITIES = ['Property', 'Lot', 'Lease', 'RentDue', 'Payment', 'Transaction', 'BankTransaction', 'Document', 'Holder', 'HolderMember', 'PropertyHolder', 'Impaye', 'Quittance', 'InvestmentScenario', 'RentRevision', 'ChargeRegularization', 'MonthClose', 'Alert', 'EmailLog', 'BankImport', 'BankRule', 'TenantAccess'];

export default function SecurityCompliance() {
  const { user } = useAuth();
  const { withOwner, ownerEmail } = useOwnerFilter();
  const { isUnlocked, flags } = useFeatureFlags();
  const [exporting, setExporting] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const [bug, setBug] = useState('');
  const [sendingBug, setSendingBug] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const entries = await Promise.all(GDPR_ENTITIES.map(async (name) => {
        try { const rows = await base44.entities[name].filter(withOwner()); return [name, rows]; }
        catch { return [name, []]; }
      }));
      const payload = { exported_at: new Date().toISOString(), owner: ownerEmail, entities: Object.fromEntries(entries) };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `patrimo-rgpd-${Date.now()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('Export RGPD téléchargé');
    } catch (e) {
      toast.error('Erreur lors de l\'export');
    } finally {
      setExporting(false);
    }
  };

  const handleBug = async () => {
    if (!bug.trim()) { toast.error('Décrivez le bug'); return; }
    setSendingBug(true);
    const body = `Signalement de bug\n\nDescription:\n${bug}\n\nUtilisateur: ${user?.email || '—'}\nRôle: ${user?.role || '—'}\nDate: ${new Date().toLocaleString('fr-FR')}\nNavigateur: ${navigator.userAgent}\nURL: ${window.location.href}`;
    try {
      await base44.integrations.Core.SendEmail({ to: user.email, subject: '[Patrimo] Signalement de bug', body });
      toast.success('Signalement envoyé par email');
      setBug(''); setBugOpen(false);
    } catch (e) {
      toast.error('Erreur lors de l\'envoi');
    } finally {
      setSendingBug(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Journal d'audit */}
      <div className="flex items-start gap-3 mb-2">
        <ScrollText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h3 className="font-semibold text-sm">Journal d'audit</h3>
          <p className="text-xs text-muted-foreground">Historique chronologique des opérations sensibles de votre compte.</p>
        </div>
      </div>
      {isUnlocked('audit_log')
        ? <Suspense fallback={<Fallback />}><AuditLog /></Suspense>
        : <LockedPanel title="Journal d'audit" desc="Historique chronologique des opérations sensibles de votre compte." unlockText={flags.audit_log?.unlockText} icon={ScrollText} />}

      {/* Export RGPD */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <Download className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm">Export RGPD de mes données</h3>
            <p className="text-xs text-muted-foreground mb-3">Téléchargez une copie de toutes vos données personnelles au format JSON.</p>
            <Button onClick={handleExport} disabled={exporting} size="sm" variant="outline" className="gap-2">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exporting ? 'Export en cours…' : 'Exporter mes données'}
            </Button>
          </div>
        </div>
      </div>

      {/* Signaler un bug */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <Bug className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm">Signaler un bug</h3>
            <p className="text-xs text-muted-foreground mb-3">Décrivez un dysfonctionnement ; un rapport vous est envoyé par email.</p>
            <Button onClick={() => setBugOpen(true)} size="sm" variant="outline" className="gap-2">
              <Bug className="w-4 h-4" /> Ouvrir un signalement
            </Button>
          </div>
        </div>
        <Dialog open={bugOpen} onOpenChange={setBugOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Signaler un bug</DialogTitle>
              <DialogDescription>Décrivez le problème rencontré et les étapes pour le reproduire.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="bug-desc" className="text-xs text-muted-foreground">Description</Label>
              <Textarea id="bug-desc" rows={5} value={bug} onChange={(e) => setBug(e.target.value)} placeholder="Que s'est-il passé ? Quand ? Sur quel écran ?" />
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline" size="sm">Annuler</Button></DialogClose>
              <Button size="sm" onClick={handleBug} disabled={sendingBug} className="gap-2">
                {sendingBug ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bug className="w-4 h-4" />}
                {sendingBug ? 'Envoi…' : 'Envoyer le signalement'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Zone dangereuse */}
      <div className="border border-destructive/30 rounded-xl p-5 bg-destructive/5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <h3 className="font-semibold text-sm text-destructive">Zone dangereuse — suppression du compte</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          La suppression de votre compte est <strong>irréversible</strong>. Toutes vos données (biens, lots, transactions…) seront définitivement effacées et vous serez déconnecté.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="gap-2">
              <Trash2 className="w-4 h-4" /> Supprimer mon compte
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer votre compte ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action est <strong>irréversible</strong>. Toutes vos données seront définitivement supprimées et vous serez déconnecté.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  try {
                    await base44.auth.deleteMe();
                    toast.success('Compte supprimé. Au revoir !');
                    setTimeout(() => base44.auth.logout('/'), 1500);
                  } catch {
                    toast.error('Erreur lors de la suppression. Contactez le support.');
                  }
                }}
              >
                Oui, supprimer mon compte
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}