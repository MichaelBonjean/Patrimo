import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  AlertTriangle, CheckCircle2, FileWarning, Bell, CalendarClock,
  Wallet, CircleAlert, Loader2, ArrowRight, Inbox,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const DOMAIN_META = {
  payment: { icon: Wallet, label: 'Banque' },
  document: { icon: FileWarning, label: 'Document' },
  impaye: { icon: AlertTriangle, label: 'Impayé' },
  alert: { icon: Bell, label: 'Alerte' },
  rentRevision: { icon: CircleAlert, label: 'Indexation' },
  monthClose: { icon: CalendarClock, label: 'Clôture' },
};

// Priorité d'affichage → (libellé, tone). 0 = le plus urgent.
const PRIORITY_META = [
  { label: 'Urgent', tone: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },        // ERROR / urgent
  { label: 'Urgent', tone: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  { label: 'Important', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { label: 'À traiter', tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { label: 'À confirmer', tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
];
function priorityMeta(p) {
  return PRIORITY_META[Math.min(Math.max(p || 4, 0), PRIORITY_META.length - 1)];
}

// Action recommandée + bouton direct par (domain, level).
const ACTION_MAP = {
  'document|ERROR': { action: 'Réanalyser le document', label: 'Revoir', url: '/import' },
  'document|NEEDS_ACTION': { action: 'Catégoriser le document', label: 'Classifier', url: '/import' },
  'document|NEEDS_CONFIRMATION': { action: 'Vérifier la donnée extraite', label: 'Vérifier', url: '/import' },
  'payment|NEEDS_ACTION': { action: 'Associer le paiement à un bien / bail', label: 'Associer', url: '/banque' },
  'payment|NEEDS_CONFIRMATION': { action: 'Confirmer le rapprochement', label: 'Confirmer', url: '/banque' },
  'impaye|NEEDS_ACTION': { action: 'Relancer le locataire / encaisser', label: 'Relancer', url: '/loyers?tab=impayes' },
  'alert|NEEDS_ACTION': { action: "Traiter l'alerte", label: 'Traiter', url: '/' },
  'rentRevision|NEEDS_ACTION': { action: 'Appliquer la révision de loyer', label: 'Appliquer', url: '/loyers?tab=loyers-revision' },
  'rentRevision|NEEDS_CONFIRMATION': { action: 'Examiner le blocage', label: 'Examiner', url: '/loyers?tab=loyers-revision' },
  'monthClose|NEEDS_ACTION': { action: 'Clôturer le mois', label: 'Clôturer', url: '/banque?tab=cloture' },
};

/**
 * Transforme un verdict (level/domain/reason/linked_label/action_url) en item
 * présentable : titre + explication courte + priorité + objet + action + bouton.
 */
function enrichItem(v) {
  const meta = DOMAIN_META[v.domain] || DOMAIN_META.alert;
  const action = ACTION_MAP[`${v.domain}|${v.level}`] || { action: "Action requise", label: 'Ouvrir', url: v.action_url || '/' };
  // Découpe le reason sur " — " en titre / explication (convention du moteur).
  const reason = v.reason || '';
  let title = reason;
  let explanation = '';
  const sep = reason.indexOf(' — ');
  if (sep >= 0) {
    title = reason.slice(0, sep).trim();
    explanation = reason.slice(sep + 3).trim();
  }
  if (!title) title = v.linked_label || meta.label;
  const object = v.linked_label && v.linked_label !== title ? v.linked_label : meta.label;
  return {
    ...v,
    title,
    explanation,
    object,
    icon: meta.icon,
    domainLabel: meta.label,
    prio: priorityMeta(v.priority),
    recommendedAction: action.action,
    actionLabel: action.label,
    actionUrl: v.action_url || action.url,
  };
}

export default function AFaire() {
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['attention-queue'],
    queryFn: () => base44.functions.invoke('computeAttentionQueue', {}),
    staleTime: 30_000,
  });

  const queue = data?.data || data || {};
  const items = (queue.items || []).map(enrichItem);
  const count = queue.count ?? items.length;
  const autoCount = queue.auto_count || 0;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <Inbox className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">À faire</h1>
          <p className="text-sm text-muted-foreground">
            Uniquement les exceptions qui nécessitent votre intervention.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => refetch()} disabled={isLoading}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Rafraîchir'}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
      ) : count === 0 ? (
        /* ÉTAT VALORISÉ : tout est à jour */
        <Card className="p-10 text-center border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/30 dark:border-emerald-900">
          <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-semibold text-emerald-800 dark:text-emerald-200">Tout est à jour ✓</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Aucune action requise de votre part.
            {autoCount > 0 && ` ${autoCount} opération(s) traitée(s) automatiquement par Patrimo.`}
          </p>
          <Button variant="outline" size="sm" className="mt-5" onClick={() => navigate('/')}>
            Retour au tableau de bord
          </Button>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-semibold">
              {count}
            </span>
            <span className="text-muted-foreground">à traiter{autoCount > 0 ? ` · ${autoCount} traitées automatiquement` : ''}</span>
          </div>

          <div className="space-y-2.5">
            {items.map((it, i) => {
              const Icon = it.icon;
              return (
                <Card key={i} className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <p className="font-medium text-sm leading-snug flex-1">{it.title}</p>
                        <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${it.prio.tone}`}>
                          {it.prio.label}
                        </span>
                      </div>
                      {it.explanation && (
                        <p className="text-sm text-muted-foreground mt-0.5">{it.explanation}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground/80">
                        <span className="truncate">Objet : {it.object}</span>
                        <span aria-hidden>·</span>
                        <span className="truncate">{it.recommendedAction}</span>
                      </div>
                    </div>
                    <Button size="sm" className="shrink-0 gap-1.5" onClick={() => navigate(it.actionUrl)}>
                      {it.actionLabel}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}