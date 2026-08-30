import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { base44 } from '@/api/base44Client';
import { LEGAL_DOCS } from '@/lib/legalDocs';
import { toast } from 'sonner';

// Capture du consentement aux CGU + politique de confidentialité à la première
// connexion. Persisté dans User.legal_acceptance (horodaté + versionné).
export default function LegalConsentGate({ user }) {
  const [open, setOpen] = useState(false);
  const [cgu, setCgu] = useState(false);
  const [conf, setConf] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOpen(!!user && !user.legal_acceptance);
  }, [user]);

  const accept = async () => {
    if (!cgu || !conf) { toast.error('Veuillez accepter les deux documents.'); return; }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await base44.auth.updateMe({
        legal_acceptance: {
          cgu_version: LEGAL_DOCS.cgu.version,
          cgu_date: now,
          confidentialite_version: LEGAL_DOCS.confidentialite.version,
          confidentialite_date: now,
        },
      });
      setOpen(false);
      toast.success('Votre consentement a été enregistré.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => { /* ne pas fermer sans accepter */ }}>
      <DialogContent className="max-w-lg" onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Mise à jour de nos conditions d'utilisation</DialogTitle>
          <DialogDescription>
            Pour continuer à utiliser Patrimo, merci d'accepter nos documents légaux.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <Checkbox checked={cgu} onCheckedChange={(v) => setCgu(!!v)} className="mt-0.5" />
            <span>J'accepte les <Link to="/cgu" target="_blank" rel="noreferrer" className="underline">Conditions Générales d'Utilisation</Link> (version {LEGAL_DOCS.cgu.version}).</span>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <Checkbox checked={conf} onCheckedChange={(v) => setConf(!!v)} className="mt-0.5" />
            <span>J'accepte la <Link to="/confidentialite" target="_blank" rel="noreferrer" className="underline">Politique de confidentialité</Link> (version {LEGAL_DOCS.confidentialite.version}).</span>
          </label>
        </div>
        <DialogFooter>
          <Button onClick={accept} disabled={saving || !cgu || !conf} className="w-full">
            {saving ? 'Enregistrement…' : 'J\u2019accepte et continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}