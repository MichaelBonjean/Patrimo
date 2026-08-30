import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Activity } from 'lucide-react';

const HIST_KEY = 'patrimo-status-history';
const loadHist = () => { try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { return []; } };
const saveHist = (arr) => localStorage.setItem(HIST_KEY, JSON.stringify(arr.slice(-30)));

const isUp = (s) => s === 'up' || s === 'operational';
const isDown = (s) => s === 'down';
const statusColor = (s) => isUp(s) ? 'bg-emerald-500' : isDown(s) ? 'bg-red-500' : 'bg-amber-400';
const statusLabel = (s) => isUp(s) ? 'Opérationnel' : isDown(s) ? 'Indisponible' : s === 'degraded' ? 'Dégradé' : 'Inconnu';

function ServiceCard({ name, status, Icon, desc }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-muted-foreground" />
          <span className="font-semibold text-sm">{name}</span>
        </div>
        {status === undefined || status === 'checking' ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : isUp(status) ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
        ) : isDown(status) ? (
          <XCircle className="w-5 h-5 text-red-600" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-amber-500" />
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
      {status !== undefined && status !== 'checking' && (
        <div className="mt-2"><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${isUp(status) ? 'text-emerald-700' : isDown(status) ? 'text-red-700' : 'text-amber-700'}`}><span className={`w-2 h-2 rounded-full ${statusColor(status)}`} /> {statusLabel(status)}</span></div>
      )}
    </div>
  );
}

export default function Statut() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hist, setHist] = useState(loadHist);

  useEffect(() => {
    (async () => {
      try {
        const res = await base44.functions.invoke('checkServices', {});
        const d = res?.data || {};
        setData(d);
        const today = new Date().toISOString().slice(0, 10);
        const cur = loadHist().filter((h) => h.date !== today);
        cur.push({ date: today, app: d.app, base44: d.base44, stripe: d.stripe });
        saveHist(cur);
        setHist(cur);
      } catch (e) {
        setData({ app: 'down', base44: 'unknown', stripe: 'unknown' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 30 derniers jours
  const days = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(now.getTime() - i * 86400000);
    const key = dt.toISOString().slice(0, 10);
    const snap = hist.find((h) => h.date === key);
    days.push({ key, label: dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), snap });
  }
  const operationalDays = days.filter((d) => d.snap && isUp(d.snap.app) && isUp(d.snap.base44) && isUp(d.snap.stripe)).length;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-display font-semibold">État des services</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">Disponibilité en temps réel et historique sur 30 jours.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ServiceCard name="Application Patrimo" status={loading ? 'checking' : data?.app} Icon={CheckCircle2} desc="Interface et API applicative" />
        <ServiceCard name="Base44" status={loading ? 'checking' : data?.base44} Icon={Activity} desc="Hébergement & base de données" />
        <ServiceCard name="Stripe" status={loading ? 'checking' : data?.stripe} Icon={CheckCircle2} desc="Paiements des abonnements" />
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm">Historique — 30 derniers jours</h2>
          <span className="text-xs text-muted-foreground">{operationalDays}/30 jours entièrement opérationnels</span>
        </div>
        <div className="overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {days.map((d) => {
              const ok = d.snap && isUp(d.snap.app) && isUp(d.snap.base44) && isUp(d.snap.stripe);
              const partial = d.snap && !ok && (isUp(d.snap.app) || isUp(d.snap.base44) || isUp(d.snap.stripe));
              const color = !d.snap ? 'bg-muted' : ok ? 'bg-emerald-500' : partial ? 'bg-amber-400' : 'bg-red-500';
              return (
                <div key={d.key} className="flex flex-col items-center gap-1" title={`${d.key} : ${d.snap ? JSON.stringify(d.snap) : 'pas de mesure'}`}>
                  <div className={`w-2.5 h-7 rounded-sm ${color}`} />
                  <span className="text-[10px] text-muted-foreground">{d.label}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Opérationnel</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> Dégradé</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Indisponible</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-muted" /> Pas de mesure</span>
        </div>
        <p className="text-[11px] text-muted-foreground/70 mt-3">
          Mesures relevées à chaque visite de cette page. Pour une granularité plus fine, un monitoring dédié peut être activé.
        </p>
      </div>

      {data?.checked_at && (
        <p className="text-xs text-muted-foreground text-center">Dernière vérification : {new Date(data.checked_at).toLocaleString('fr-FR')}</p>
      )}
    </div>
  );
}