import React, { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { clearDemoData } from '@/lib/demoSeed';
import { toast } from 'sonner';
import { Mail, Globe, Bell, Trash2, Loader2, FlaskConical, ImageIcon, Upload } from 'lucide-react';

const NOTIFS = [
  { key: 'echeances_impayes', label: 'Alertes impayés & échéances', desc: 'Recevez un email à chaque impayé ou échéance manquée.' },
  { key: 'recap_mensuel', label: 'Récapitulatif mensuel', desc: 'Synthèse de votre patrimoine à la fin de chaque mois.' },
  { key: 'alertes_documents', label: 'Alertes documents', desc: 'Rappels pour bails, DPE et assurances qui expirent.' },
];

export default function AccountPreferences() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const locale = user?.data?.locale || 'fr';
  const notifs = user?.data?.notifications || {};
  const [savingNotif, setSavingNotif] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInput = useRef(null);
  const logoUrl = user?.data?.report_logo_url;

  const initials = (user?.full_name || user?.email || '?').trim().charAt(0).toUpperCase();

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Sélectionnez une image'); return; }
    setUploadingLogo(true);
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      await base44.auth.updateMe({ ...(user?.data || {}), report_logo_url: res.file_url });
      await queryClient.invalidateQueries();
      toast.success('Logo enregistré');
    } catch (err) { toast.error(err?.message || 'Échec de l’upload'); }
    finally { setUploadingLogo(false); if (fileInput.current) fileInput.current.value = ''; }
  };
  const handleLogoRemove = async () => {
    try {
      const next = { ...(user?.data || {}) };
      delete next.report_logo_url;
      await base44.auth.updateMe(next);
      await queryClient.invalidateQueries();
      toast.success('Logo retiré');
    } catch { toast.error('Échec'); }
  };

  const saveLocale = async (val) => {
    if (val === 'en') { toast.info("L'anglais arrivera bientôt"); return; }
    try { await base44.auth.updateMe({ ...(user?.data || {}), locale: val }); toast.success('Langue mise à jour'); }
    catch { toast.error("Erreur lors de l'enregistrement"); }
  };

  const toggleNotif = async (key, val) => {
    setSavingNotif(key);
    const next = { ...notifs, [key]: val };
    try {
      await base44.auth.updateMe({ ...(user?.data || {}), notifications: next });
      toast.success('Préférence enregistrée');
    } catch { toast.error("Erreur lors de l'enregistrement"); }
    finally { setSavingNotif(null); }
  };

  const handleClearDemo = async () => {
    if (!user?.email) { toast.error('Compte introuvable'); return; }
    setClearing(true);
    try {
      await clearDemoData(user.email);
      await queryClient.invalidateQueries();
      toast.success('Données de démo effacées');
    } catch (e) { toast.error(e?.message || 'Erreur'); }
    finally { setClearing(false); }
  };

  return (
    <div className="space-y-6">
      {/* Profil */}
      <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-bold shrink-0">{initials}</div>
        <div className="min-w-0">
          <p className="font-semibold text-base">{user?.full_name || '—'}</p>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{user?.email}</span></p>
          <Badge variant="secondary" className="mt-1.5 capitalize">{user?.role || 'user'}</Badge>
        </div>
      </div>

      {/* Logo de co-branding (dossier bancaire) */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-1"><ImageIcon className="w-4 h-4 text-muted-foreground" /><h3 className="font-medium text-sm">Logo de co-branding</h3></div>
        <p className="text-xs text-muted-foreground mb-4">Votre logo personnel affiché en page de garde du dossier patrimonial PDF (idéal pour un dossier de renégociation de prêt).</p>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-lg border border-border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
            {logoUrl ? <img src={logoUrl} alt="logo" className="w-full h-full object-contain" /> : <ImageIcon className="w-7 h-7 text-muted-foreground/40" />}
          </div>
          <div className="flex flex-col gap-2">
            <input ref={fileInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleLogoUpload} />
            <Button variant="outline" size="sm" className="gap-2" disabled={uploadingLogo} onClick={() => fileInput.current?.click()}>
              {uploadingLogo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploadingLogo ? 'Upload…' : logoUrl ? 'Remplacer le logo' : 'Téléverser un logo'}
            </Button>
            {logoUrl && <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={handleLogoRemove}><Trash2 className="w-4 h-4" />Retirer</Button>}
          </div>
        </div>
      </div>

      {/* Langue */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-1"><Globe className="w-4 h-4 text-muted-foreground" /><h3 className="font-medium text-sm">Langue de l'interface</h3></div>
        <p className="text-xs text-muted-foreground mb-3">L'affichage de l'application utilisera cette langue.</p>
        <Select value={locale} onValueChange={saveLocale}>
          <SelectTrigger className="w-full max-w-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fr">Français</SelectItem>
            <SelectItem value="en">English (bientôt)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Notifications */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-1"><Bell className="w-4 h-4 text-muted-foreground" /><h3 className="font-medium text-sm">Notifications par email</h3></div>
        <p className="text-xs text-muted-foreground mb-4">Choisissez les alertes que vous souhaitez recevoir.</p>
        <div className="divide-y divide-border">
          {NOTIFS.map((n) => (
            <div key={n.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-medium">{n.label}</p>
                <p className="text-xs text-muted-foreground">{n.desc}</p>
              </div>
              <Switch checked={!!notifs[n.key]} disabled={savingNotif === n.key} onCheckedChange={(v) => toggleNotif(n.key, v)} />
            </div>
          ))}
        </div>
      </div>

      {/* Effacer données démo */}
      <div className="border border-amber-500/30 rounded-xl p-5 bg-amber-50 dark:bg-amber-950/20">
        <div className="flex items-center gap-2 mb-2">
          <FlaskConical className="w-4 h-4 text-amber-600" />
          <h3 className="font-semibold text-sm text-amber-700 dark:text-amber-500">Données de démonstration</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Supprime définitivement tous les biens, lots et transactions marqués comme données de démonstration. Vos données réelles ne sont pas affectées.
        </p>
        <Button onClick={handleClearDemo} disabled={clearing} size="sm" variant="outline" className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-100 dark:text-amber-500 dark:border-amber-800 dark:hover:bg-amber-950/40">
          {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          {clearing ? 'Suppression…' : 'Effacer les données de démo'}
        </Button>
      </div>
    </div>
  );
}