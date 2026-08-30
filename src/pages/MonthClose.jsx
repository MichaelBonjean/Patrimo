// Clôturer mon mois — wizard guidé
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { FileUp, ListChecks, Wallet, AlertTriangle, Receipt, Loader2 } from 'lucide-react';
import MonthPicker from '@/components/monthclose/MonthPicker';
import StepCard from '@/components/monthclose/StepCard';
import MonthSummary from '@/components/monthclose/MonthSummary';
import { formatCurrency, formatPercent } from '@/lib/formatters';
import { triggerMilestone } from '@/lib/celebrations';

export default function MonthClose() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['month-close', year, month],
    queryFn: () => base44.functions.invoke('manageMonthClose', { op: 'analyze', year, month }).then((r) => r.data),
  });
  const s = data?.summary;
  const status = data?.status || 'open';

  const reload = () => qc.invalidateQueries({ queryKey: ['month-close', year, month] });

  const act = async (op) => {
    setBusy(true);
    try {
      await base44.functions.invoke('manageMonthClose', { op, year, month });
      toast.success(op === 'close' ? 'Mois clôturé.' : 'Mois rouvert (historisé).');
      if (op === 'close') { try { await triggerMilestone('first_month_closed'); } catch { /* noop */ } }
      reload();
    } catch (e) {
      toast.error(e?.message || 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const steps = s ? [
    {
      index: 1, icon: FileUp, title: 'Importer / synchroniser les transactions',
      description: 'Importez le flux bancaire du mois ou saisissez les opérations manuellement.',
      to: '/import', done: s.bankTxCount > 0,
      metrics: [
        { label: 'Importées', value: String(s.bankTxCount) },
        { label: 'À rapprocher', value: String(s.bankPending), tone: s.bankPending > 0 ? 'warning' : 'positive' },
      ],
    },
    {
      index: 2, icon: ListChecks, title: 'Résoudre les transactions à vérifier',
      description: 'Catégorisez les opérations non reconnues avant clôture.',
      to: '/import', done: s.toVerifyCount === 0,
      metrics: [
        { label: 'À vérifier', value: String(s.toVerifyCount), tone: s.toVerifyCount > 0 ? 'warning' : 'positive' },
        { label: 'Non catégorisées', value: String(s.uncategorizedCount) },
      ],
    },
    {
      index: 3, icon: Wallet, title: 'Rapprocher les loyers',
      description: 'Affectez les paiements reçus aux échéances (CAF, locataires).',
      to: '/compte-locataire', done: s.encaissementRate >= 99.5,
      metrics: [
        { label: 'Encaissement', value: formatPercent(s.encaissementRate), tone: s.encaissementRate >= 99.5 ? 'positive' : 'warning' },
        { label: 'Partiels', value: String(s.partialCount) },
        { label: 'CAF', value: formatCurrency(s.cafAmount) },
      ],
    },
    {
      index: 4, icon: AlertTriangle, title: 'Traiter les impayés',
      description: 'Relancez ou régularisez les échéances à solde débiteur.',
      to: '/impayes', done: s.impayeCount === 0,
      metrics: [
        { label: 'Impayés', value: String(s.impayeCount), tone: s.impayeCount > 0 ? 'negative' : 'positive' },
        { label: 'Montant', value: formatCurrency(s.impayeAmount), tone: s.impayeCount > 0 ? 'negative' : 'positive' },
      ],
    },
    {
      index: 5, icon: Receipt, title: 'Générer / envoyer les quittances',
      description: 'Émettez les quittances des échéances réglées.',
      to: '/quittances', done: s.quittanceUnsent === 0,
      metrics: [
        { label: 'À envoyer', value: String(s.quittanceUnsent), tone: s.quittanceUnsent > 0 ? 'warning' : 'positive' },
        { label: 'Envoyées', value: String(s.quittanceSent), tone: 'positive' },
      ],
    },
  ] : [];

  const doneCount = steps.filter((st) => st.done).length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1400px]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Clôturer mon mois</h1>
            <p className="text-sm text-muted-foreground mt-1">Procédure guidée — bouclez votre exercice en quelques minutes.</p>
          </div>
          <MonthPicker year={year} month={month} onYear={setYear} onMonth={setMonth} />
        </div>
        {s && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${(doneCount / 5) * 100}%` }} />
            </div>
            <span className="text-xs text-muted-foreground number-fr">{doneCount}/5 étapes prêtes</span>
          </div>
        )}
      </div>

      {isLoading || !s ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-3">
            {steps.map((st) => <StepCard key={st.index} {...st} />)}
          </div>
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-4">
              <MonthSummary summary={s} status={status} onClose={() => act('close')} onReopen={() => act('reopen')} busy={busy} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}