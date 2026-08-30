import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Sparkles } from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useOwnerFilter } from '@/lib/tenantFilter';

function shareCard(node) {
  // best-effort capture + partage natif (Capacitor) ou téléchargement.
  if (!node) return;
  import('html2canvas').then(async ({ default: html2canvas }) => {
    const canvas = await html2canvas(node, { backgroundColor: '#ffffff', scale: 2 });
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], 'patrimo-automatisation.png', { type: 'image/png' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Mon taux d\'automatisation Patrimo' });
          return;
        }
      } catch (_e) { /* fallback download */ }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'patrimo-automatisation.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  }).catch(() => {});
}

export default function AutomationRateCard({ rate, totals, autoCount, lastRate }) {
  const { withOwner } = useOwnerFilter();
  const [open, setOpen] = useState(false);
  const sheetRef = useRef(null);

  const { data: full } = useQuery({
    queryKey: ['automation-rate', 'current', 'detail'],
    queryFn: () => base44.functions.invoke('computeAutomationRate', {}),
    enabled: open,
    staleTime: 60_000,
  });
  const { data: rules = [] } = useQuery({
    queryKey: ['bank-rules', 'count'],
    queryFn: () => base44.entities.BankRule.filter(withOwner({ is_active: true })),
    staleTime: 60_000,
  });

  const detail = full?.data || full || {};
  const categories = detail.categories || [];
  const cls = categories.find((c) => c.key === 'classification') || {};
  const rec = categories.find((c) => c.key === 'rapprochement') || {};
  const rd = categories.find((c) => c.key === 'rent_dues') || {};
  const rulesActive = rules.length;

  const delta = (rate != null && lastRate != null) ? (rate - lastRate) : null;
  const deltaTone = delta == null ? 'text-muted-foreground' : delta >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const deltaLabel = delta == null ? '' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1).replace('.', ',')} pt vs le mois dernier`;

  const operations = totals?.auto ?? autoCount ?? 0;

  return (
    <div id="kpi-automation" className="rounded-xl border border-accent/30 bg-gradient-to-br from-accent/10 to-transparent p-4 flex flex-col gap-2 cursor-pointer hover:shadow-sm transition-shadow"
      onClick={() => setOpen(true)}>
      <div className="flex items-center gap-2 text-accent-foreground/80">
        <div className="p-1.5 rounded-lg bg-accent/20 text-accent-foreground">
          <Sparkles className="w-4 h-4 text-amber-600" />
        </div>
        <span className="text-xs font-medium">Automatisé ce mois</span>
      </div>
      <div className="text-[28px] leading-none font-display font-semibold number-fr">
        {rate == null ? '—' : `${rate} %`}
      </div>
      <div className="text-xs text-muted-foreground">
        {operations} opération{operations > 1 ? 's' : ''} traitée{operations > 1 ? 's' : ''} sans intervention
      </div>
      {delta != null && <div className={`text-[11px] font-medium ${deltaTone}`}>{deltaLabel}</div>}
      <div className="text-[10px] text-muted-foreground/80 underline">Détails →</div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="px-6 pt-6">
            <SheetTitle>Votre taux d'automatisation</SheetTitle>
            <SheetDescription>Ce que Patrimo a géré pour vous, sans intervention.</SheetDescription>
          </SheetHeader>
          <div ref={sheetRef} className="px-6 pb-6 space-y-4 bg-background">
            <div className="rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/10 to-transparent p-5 text-center">
              <p className="text-xs text-muted-foreground mb-1">Taux d'automatisation — {detail.period || ''}</p>
              <p className="text-5xl font-display font-semibold number-fr">{rate == null ? '—' : `${rate}%`}</p>
              {delta != null && <p className={`text-sm mt-1 font-medium ${deltaTone}`}>{deltaLabel}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-2xl font-semibold number-fr">{cls.auto ?? 0}</p>
                <p className="text-xs text-muted-foreground">documents classés auto</p>
                {cls.manual ? <p className="text-[11px] text-muted-foreground">+ {cls.manual} validation{cls.manual > 1 ? 's' : ''} manuelle{cls.manual > 1 ? 's' : ''}</p> : null}
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-2xl font-semibold number-fr">{rec.auto ?? 0}</p>
                <p className="text-xs text-muted-foreground">transactions rapprochées auto</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-2xl font-semibold number-fr">{rulesActive}</p>
                <p className="text-xs text-muted-foreground">règles apprises actives</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-2xl font-semibold number-fr">{rd.auto ?? 0}</p>
                <p className="text-xs text-muted-foreground">échéances suivies auto</p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium mb-1">Méthode de calcul (transparence)</p>
              <p className="text-[11px] text-muted-foreground leading-snug">{detail.methodology?.slice(0, 220)}</p>
            </div>
          </div>
          <SheetFooter className="px-6 pb-6 pt-2">
            <Button onClick={() => shareCard(sheetRef.current)} className="gap-2 w-full">
              <Sparkles className="w-4 h-4" /> Partager ma performance
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}