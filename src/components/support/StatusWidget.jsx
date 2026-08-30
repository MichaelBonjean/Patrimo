import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';

const CACHE_KEY = 'patrimo-status-cache';
const TTL = 5 * 60 * 1000;
const isUp = (s) => s === 'up' || s === 'operational';

// Widget compact d'état des services (caché 5 min). Posé dans le footer.
export default function StatusWidget() {
  const [s, setS] = useState(null);

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (cached && Date.now() - cached.t < TTL) { setS(cached.d); return; }
    } catch (_) {}
    (async () => {
      try {
        const res = await base44.functions.invoke('checkServices', {});
        const d = res?.data;
        if (d) { setS(d); localStorage.setItem(CACHE_KEY, JSON.stringify({ d, t: Date.now() })); }
      } catch (_) {}
    })();
  }, []);

  const allUp = s && (s.app === 'up') && (isUp(s.base44)) && (s.stripe === 'up');
  const partial = s && !allUp && (s.app === 'up' || isUp(s.base44) || s.stripe === 'up');
  const color = !s ? 'bg-muted-foreground/40 animate-pulse' : allUp ? 'bg-emerald-500' : partial ? 'bg-amber-500' : 'bg-red-500';
  const label = !s ? 'Vérification…' : allUp ? 'Tous services opérationnels' : partial ? 'Perturbation partielle' : 'Service indisponible';

  return (
    <Link to="/statut" className="inline-flex items-center gap-1.5 hover:text-foreground">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span>{label}</span>
    </Link>
  );
}