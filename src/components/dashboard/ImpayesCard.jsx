import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Mail, FileText, CheckCircle2, Clock, History } from 'lucide-react';
import { toast } from 'sonner';
import {
  getDaysOutstanding, buildRelanceEmail, formatImpayeStatus, relanceHistorySummary
} from '@/lib/impayeUtils';
import { buildMiseEnDemeure } from '@/lib/miseEnDemeureReport';
import { formatCurrency } from '@/lib/formatters';

export default function ImpayesCard({ impayes = [], landlordName = '', landlordEmail = '' }) {
  const queryClient = useQueryClient();
  const [compose, setCompose] = useState(null);
  const [sending, setSending] = useState(false);
  const [historyFor, setHistoryFor] = useState(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['impayes'] });

  const actifs = impayes.filter(i => i.status !== 'régularisé' && i.status !== 'abandonné');
  const totalManquant = actifs.reduce((s, i) => s + (i.missing_amount || 0), 0);
  const nbCritiques = actifs.filter(i => getDaysOutstanding(i.period) > 30).length;

  const openRelance = (impaye) => {
    const email = buildRelanceEmail(impaye, landlordName || 'Votre bailleur');
    setCompose({ impaye, to: impaye.tenant_email || '', subject: email.subject, body: email.body });
  };

  const sendRelance = async () => {
    if (!compose) return;
    if (!compose.to) {
      toast.error('Aucune adresse email enregistrée pour ce locataire.');
      return;
    }
    setSending(true);
    try {
      await base44.integrations.Core.SendEmail({
        to: compose.to,
        subject: compose.subject,
        body: compose.body
      });
      const entry = {
        date: new Date().toISOString(),
        type: 'relance_amicale',
        method: 'email',
        note: `Email envoyé à ${compose.to}`
      };
      await base44.entities.Impaye.update(compose.impaye.id, {
        status: 'relance_amicale',
        relance_history: [...(compose.impaye.relance_history || []), entry]
      });
      toast.success('Relance amicale envoyée.');
      setCompose(null);
      refresh();
    } catch (e) {
      toast.error("Échec de l'envoi : " + (e?.message || 'erreur inconnue'));
    } finally {
      setSending(false);
    }
  };

  const envoyerMiseEnDemeure = async (impaye) => {
    try {
      const doc = buildMiseEnDemeure(impaye, landlordName);
      doc.save(`mise_en demeure_${impaye.period}_${(impaye.tenant_name || 'locataire').replace(/\s+/g, '_')}.pdf`);
      const entry = {
        date: new Date().toISOString(),
        type: 'mise_en_demeure',
        method: 'courrier_lrar',
        note: 'Lettre de mise en demeure générée (envoi LRAR à la charge du bailleur).'
      };
      await base44.entities.Impaye.update(impaye.id, {
        status: 'mise_en_demeure',
        relance_history: [...(impaye.relance_history || []), entry]
      });
      toast.success('Mise en demeure générée. À envoyer par LRAR.');
      refresh();
    } catch (e) {
      toast.error("Génération du PDF impossible : " + (e?.message || 'erreur'));
    }
  };

  const regulariser = async (impaye) => {
    try {
      const entry = {
        date: new Date().toISOString(),
        type: 'régularisation',
        method: 'manuel',
        note: 'Marqué comme régularisé par le bailleur.'
      };
      await base44.entities.Impaye.update(impaye.id, {
        status: 'régularisé',
        regularized_date: new Date().toISOString().slice(0, 10),
        relance_history: [...(impaye.relance_history || []), entry]
      });
      toast.success('Impayé marqué comme régularisé.');
      refresh();
    } catch (e) {
      toast.error("Mise à jour impossible : " + (e?.message || 'erreur'));
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${actifs.length > 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Impayés en cours</h2>
            <p className="text-xs text-muted-foreground">
              {actifs.length === 0
                ? 'Aucun impayé — trésorerie à jour'
                : `${actifs.length} impayé${actifs.length > 1 ? 's' : ''} · ${formatCurrency(totalManquant)} dû${nbCritiques ? ` · ${nbCritiques} > 30 j` : ''}`}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
        {actifs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-emerald-600">
            <CheckCircle2 className="w-10 h-10 mb-2 opacity-50" />
            <p className="text-sm font-medium">Aucun loyer en retard</p>
            <p className="text-xs text-muted-foreground">Les loyers du mois ont été encaissés.</p>
          </div>
        ) : (
          actifs.map(impaye => {
            const days = getDaysOutstanding(impaye.period);
            const isCritical = days > 30;
            const status = formatImpayeStatus(impaye.status);
            const history = relanceHistorySummary(impaye.relance_history);
            return (
              <div key={impaye.id} className={`rounded-lg border p-3 ${isCritical ? 'border-red-300 bg-red-50/50' : 'border-border bg-muted/30'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{impaye.tenant_name}</span>
                      <Badge variant="secondary" className={`text-xs ${status.className}`}>{status.label}</Badge>
                      {isCritical && (
                        <Badge className="text-xs bg-red-600 text-white">
                          <Clock className="w-3 h-3 mr-1" />J+{days}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {impaye.property_name} — {impaye.lot_designation} · {impaye.period}
                    </p>
                    <p className="text-sm font-semibold mt-1">
                      {formatCurrency(impaye.missing_amount)} <span className="text-xs font-normal text-muted-foreground">restant sur {formatCurrency(impaye.expected_amount)}</span>
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span><Clock className="w-3 h-3 inline mr-0.5" />{days} j de retard</span>
                      {(history.relance_amicale || 0) > 0 && <span>Relance : {history.relance_amicale}</span>}
                      {(history.mise_en_demeure || 0) > 0 && <span>MED : {history.mise_en_demeure}</span>}
                      {(impaye.relance_history || []).length > 0 && (
                        <button onClick={() => setHistoryFor(impaye)} className="inline-flex items-center text-primary hover:underline">
                          <History className="w-3 h-3 mr-0.5" />Historique
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => openRelance(impaye)} disabled={impaye.status === 'relance_amicale' || impaye.status === 'mise_en_demeure'}>
                    <Mail className="w-3.5 h-3.5" />Relance amicale
                  </Button>
                  {!impaye.tenant_email && (
                    <span className="text-xs text-amber-600">email manquant</span>
                  )}
                  <Button size="sm" variant="outline" onClick={() => envoyerMiseEnDemeure(impaye)}>
                    <FileText className="w-3.5 h-3.5" />Mise en demeure
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => regulariser(impaye)}>
                    <CheckCircle2 className="w-3.5 h-3.5" />Régulariser
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Dialogue composition relance */}
      <Dialog open={!!compose} onOpenChange={(o) => !o && setCompose(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Relance amicale — loyer {compose?.impaye?.period}</DialogTitle>
            <DialogDescription>
              Email pré-rédigé adressé à {compose?.impaye?.tenant_name}. Vous pouvez ajuster le contenu avant l'envoi.
            </DialogDescription>
          </DialogHeader>
          {compose && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Destinataire</Label>
                <Input value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })} placeholder="email du locataire" />
              </div>
              <div>
                <Label className="text-xs">Objet</Label>
                <Input value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Message</Label>
                <Textarea rows={12} value={compose.body} onChange={(e) => setCompose({ ...compose, body: e.target.value })} className="text-sm" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompose(null)}>Annuler</Button>
            <Button onClick={sendRelance} disabled={sending}>
              {sending ? 'Envoi…' : 'Envoyer la relance'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue historique */}
      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Historique des relances</DialogTitle>
            <DialogDescription>
              {historyFor?.tenant_name} — {historyFor?.property_name} · {historyFor?.period}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {(historyFor?.relance_history || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune action enregistrée.</p>
            ) : (
              [...historyFor.relance_history].reverse().map((h, i) => (
                <div key={i} className="text-sm border-l-2 border-primary/40 pl-3 py-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{(h.type || '').replace('_', ' ')}</span>
                    <span className="text-xs text-muted-foreground">{new Date(h.date).toLocaleDateString('fr-FR')}</span>
                  </div>
                  <p className="text-xs text-muted-foreground capitalize">{h.method} — {h.note}</p>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryFor(null)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}