import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { LifeBuoy, MessageSquare, Bug, ArrowLeft, HelpCircle, Activity, Info, Send, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function SupportSheet({ open, onOpenChange }) {
  const navigate = useNavigate();
  const [view, setView] = useState('menu');

  const [cSubj, setCSubj] = useState('');
  const [cMsg, setCMsg] = useState('');
  const [sending, setSending] = useState(false);

  const [bSubj, setBSubj] = useState('');
  const [bSteps, setBSteps] = useState('');
  const [bSending, setBSending] = useState(false);

  const lastErr = typeof window !== 'undefined' ? window.__patrimoLastError : null;

  const reset = () => { setView('menu'); setCSubj(''); setCMsg(''); setBSubj(''); setBSteps(''); };
  const close = () => { onOpenChange(false); reset(); };

  const submitContact = async () => {
    if (!cSubj.trim() || !cMsg.trim()) { toast.error('Sujet et message requis.'); return; }
    setSending(true);
    try {
      const res = await base44.functions.invoke('manageSupport', {
        action: 'create', category: 'contact', subject: cSubj.trim(), message: cMsg.trim(),
      });
      if (res?.data?.ok) { toast.success('Message envoyé. Réponse par email sous 24h.'); close(); }
      else toast.error(res?.data?.error || 'Erreur');
    } catch (e) { toast.error(e.message); }
    finally { setSending(false); }
  };

  const submitBug = async () => {
    if (!bSteps.trim()) { toast.error('Décrivez le problème rencontré.'); return; }
    setBSending(true);
    const url = window.location.href;
    const ua = navigator.userAgent;
    const subject = bSubj.trim() || 'Signalement de bug';
    const body = `${bSteps}\n\n--- Infos techniques ---\nURL: ${url}\nNavigateur: ${ua}\nErreur: ${lastErr?.message || ''}`;
    try {
      const res = await base44.functions.invoke('manageSupport', {
        action: 'create', category: 'bug', subject, message: body,
        page_url: url, user_agent: ua, stack_trace: lastErr?.stack || '',
      });
      if (res?.data?.ok) { toast.success('Bug signalé. Merci !'); close(); }
      else toast.error(res?.data?.error || 'Erreur');
    } catch (e) { toast.error(e.message); }
    finally { setBSending(false); }
  };

  const menuBtn = 'w-full flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left hover:border-primary/30 hover:shadow-sm transition-all';

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            {view !== 'menu' ? (
              <button onClick={() => setView('menu')} className="p-1 rounded hover:bg-muted -ml-1">
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : <LifeBuoy className="w-4 h-4 text-primary" />}
            Support
          </SheetTitle>
          <SheetDescription className="sr-only">Centre de support Patrimo</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {view === 'menu' && (
            <>
              <button className={menuBtn} onClick={() => { close(); navigate('/aide'); }}>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600"><HelpCircle className="h-5 w-5" /></span>
                <span className="flex-1"><span className="block font-medium text-sm">Centre d'aide</span><span className="block text-xs text-muted-foreground">10 articles + recherche</span></span>
              </button>
              <button className={menuBtn} onClick={() => setView('contact')}>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><MessageSquare className="h-5 w-5" /></span>
                <span className="flex-1"><span className="block font-medium text-sm">Nous contacter</span><span className="block text-xs text-muted-foreground">Posez votre question</span></span>
              </button>
              <button className={menuBtn} onClick={() => setView('bug')}>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600"><Bug className="h-5 w-5" /></span>
                <span className="flex-1"><span className="block font-medium text-sm">Signaler un bug</span><span className="block text-xs text-muted-foreground">Avec contexte technique auto</span></span>
              </button>
              <div className="pt-3 mt-3 border-t border-border flex flex-col gap-2 text-sm text-muted-foreground">
                <button className="flex items-center gap-2 hover:text-foreground" onClick={() => { close(); navigate('/statut'); }}>
                  <Activity className="w-4 h-4" /> État des services
                </button>
                <button className="flex items-center gap-2 hover:text-foreground" onClick={() => { close(); navigate('/a-propos'); }}>
                  <Info className="w-4 h-4" /> À propos
                </button>
              </div>
              <p className="text-xs text-muted-foreground/70 pt-2">Vos demandes sont conservées dans votre historique (RGPD).</p>
            </>
          )}

          {view === 'contact' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium">Sujet</label>
                <Input value={cSubj} onChange={(e) => setCSubj(e.target.value)} placeholder="Ex : question sur ma quittance" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium">Message</label>
                <Textarea value={cMsg} onChange={(e) => setCMsg(e.target.value)} placeholder="Décrivez votre demande…" rows={6} className="mt-1" />
              </div>
              <Button className="w-full gap-2" onClick={submitContact} disabled={sending}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Envoyer
              </Button>
            </div>
          )}

          {view === 'bug' && (
            <div className="space-y-3">
              {lastErr && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800 flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Une erreur a été détectée sur cette session et sera jointe automatiquement.</span>
                </div>
              )}
              <div>
                <label className="text-xs font-medium">Titre du bug</label>
                <Input value={bSubj} onChange={(e) => setBSubj(e.target.value)} placeholder="Ex : quittance ne se génère pas" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium">Que s'est-il passé ?</label>
                <Textarea value={bSteps} onChange={(e) => setBSteps(e.target.value)} placeholder="Étapes pour reproduire, résultat attendu…" rows={5} className="mt-1" />
              </div>
              <div className="text-xs text-muted-foreground bg-muted rounded-lg p-2">
                <p>Page : <span className="break-all">{typeof window !== 'undefined' ? window.location.href : ''}</span></p>
                <p>Navigateur et trace d'erreur joints automatiquement.</p>
              </div>
              <Button className="w-full gap-2" onClick={submitBug} disabled={bSending}>
                {bSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Signaler
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}