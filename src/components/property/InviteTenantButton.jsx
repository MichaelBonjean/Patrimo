import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Mail, Copy, Check, Link2 } from 'lucide-react';
import { toast } from 'sonner';

function getActiveTenant(lot) {
  const today = new Date();
  const active = (lot.tenants || []).find(t => {
    if (!t.entry_date) return true;
    if (new Date(t.entry_date) > today) return false;
    if (t.exit_date && new Date(t.exit_date) < today) return false;
    return true;
  });
  if (active) return active;
  if (lot.tenant_name || lot.tenant_email) {
    return { id: 'legacy', name: lot.tenant_name, email: lot.tenant_email || '', phone: lot.tenant_phone || '' };
  }
  return null;
}

export default function InviteTenantButton({ lot }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();
  const tenant = getActiveTenant(lot);

  const openDialog = () => {
    setEmail(tenant?.email || '');
    setResult(null);
    setCopied(false);
    setOpen(true);
  };

  const generate = async () => {
    if (!email.trim()) { toast.error('Email du locataire requis'); return; }
    setPending(true);
    try {
      const res = await base44.functions.invoke('generateTenantAccess', {
        lot_id: lot.id,
        tenant_id: tenant?.id,
        email: email.trim()
      });
      const data = res.data;
      if (res.status >= 400 || data?.error) {
        toast.error(data?.error || 'Erreur');
        return;
      }
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['tenant-accesses'] });
      if (data.emailed) toast.success('Accès envoyé par email au locataire.');
      else toast.warning("Email automatique indisponible — copiez le lien.");
    } catch (e) {
      toast.error('Erreur : ' + (e?.message || 'inconnue'));
    } finally {
      setPending(false);
    }
  };

  const copy = () => {
    if (!result?.link) return;
    navigator.clipboard.writeText(result.link);
    setCopied(true);
    toast.success('Lien copié');
  };

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        title="Envoyer l'accès au locataire"
        onClick={openDialog}
      >
        <Mail className="w-3.5 h-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Accès espace locataire</DialogTitle>
            <DialogDescription>
              Générez un lien personnel pour {tenant?.name || 'votre locataire'} : consultation des quittances, historique des paiements, mise à jour des coordonnées et signalement d'incidents.
            </DialogDescription>
          </DialogHeader>

          {!result ? (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Email du locataire</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="locataire@email.com" />
              </div>
              <p className="text-xs text-muted-foreground">
                Le lien est valable 90 jours et se renouvelle automatiquement à chaque visite du locataire.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-50 border border-emerald-200">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-sm text-emerald-700">
                  Accès généré{result.emailed ? ' et envoyé par email.' : ' (email non envoyé automatiquement, copiez le lien ci-dessous).'}
                </span>
              </div>
              <div>
                <Label className="text-xs"><Link2 className="w-3 h-3 inline mr-1" />Lien d'accès</Label>
                <div className="flex gap-2">
                  <Input readOnly value={result.link} className="text-xs" />
                  <Button size="icon" variant="outline" onClick={copy}>
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {!result ? (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
                <Button onClick={generate} disabled={pending}>
                  {pending ? 'Génération…' : 'Générer & envoyer'}
                </Button>
              </>
            ) : (
              <Button onClick={() => setOpen(false)}>Fermer</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}