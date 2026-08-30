import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';
import { Sparkles, FileStack, Info, Hourglass, ListChecks } from 'lucide-react';
import DropZone from '@/components/import/DropZone';
import ImportCard from '@/components/import/ImportCard';
import DocumentImportReviewDialog from '@/components/documents/DocumentImportReviewDialog';
import {
  EXAMPLE_DOCS, findDuplicates, groupImports,
} from '@/lib/importerPipeline';
import {
  decideQueue, computeQueuePositions, ACTIVE_TECHNICAL, QUEUEABLE,
} from '@/lib/documentQueue';

/**
 * Page dédiée « Importer des documents » — point d'entrée central du pipeline
 * Document First, désormais piloté par une FILE D'ANALYSE SÉQUENTIELLE
 * (un seul document analysé techniquement à la fois par patrimoine).
 *
 * Dépose de plusieurs fichiers → création de plusieurs DocumentImport en
 * statut `queued` (FIFO) → un seul appel à l'orchestrateur `processDocumentQueue`
 * qui démarre le premier document. La file avance ensuite automatiquement
 * (l'ingestion déclenche le suivant à chaque fin d'analyse), et la page
 * relance l'orchestrateur en self-heal tant que des documents sont en attente.
 *
 * Affichage en 3 groupes : En cours (≤1) · En attente (file) · À vérifier.
 */
export default function ImporterDocuments() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [reviewing, setReviewing] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());
  const lastKickRef = useRef(0);

  const importsQ = useQuery({
    queryKey: ['document-imports-page'],
    queryFn: async () => {
      const res = await base44.entities.DocumentImport.filter({});
      const list = Array.isArray(res) ? res : (res?.items || []);
      return list.sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')));
    },
    refetchInterval: (q) => {
      const has = (q.state.data || []).some((r) =>
        QUEUEABLE.has(r.status) || ACTIVE_TECHNICAL.has(r.status));
      return has ? 3000 : false;
    },
  });

  const all = useMemo(() => importsQ.data || [], [importsQ.data]);
  const imports = useMemo(() => all.filter((r) => !dismissed.has(r.id)), [all, dismissed]);

  const groups = useMemo(() => groupImports(imports), [imports]);
  const queuePositions = useMemo(() => computeQueuePositions(imports), [imports]);
  const { active, queued, toReview, recent } = groups;

  // Self-heal : tant qu'un document est démarrable (queueable et aucun actif),
  // on relance l'orchestrateur (idempotent) pour démarrer le suivant. Limité à
  // une relance toutes les 8 s pour éviter le spam.
  useEffect(() => {
    const { shouldStart } = decideQueue(imports, new Date());
    if (shouldStart && Date.now() - lastKickRef.current > 8000) {
      lastKickRef.current = Date.now();
      base44.functions.invoke('processDocumentQueue', {}).catch(() => {});
    }
  }, [imports]);

  // Démarrage de la file pour une liste de fichiers : on crée les imports en
  // `queued` (FIFO) puis on déclenche l'orchestrateur une seule fois.
  const startIngest = async (files) => {
    if (!user?.email) { toast.error('Connectez-vous pour importer.'); return; }
    const dupes = findDuplicates(files, importsQ.data || []);
    if (dupes.length) {
      const names = dupes.map((f) => f.name).join(', ');
      toast.message(`Document(s) déjà importé(s) : ${names}`, {
        description: 'Ils sont déjà dans la liste ci-dessous. Importez quand même si nécessaire.',
      });
    }
    // Position FIFO = nb de documents déjà en file + 1 (best-effort, persisté).
    const basePos = (importsQ.data || []).filter((r) => QUEUEABLE.has(r.status)).length;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        await base44.entities.DocumentImport.create({
          user_id: user.id,
          owner_id: user.email,
          file_url,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || '',
          source: 'upload_web',
          status: 'queued',
          queue_position: basePos + i + 1,
          current_stage: 'queued',
          progress_percent: 0,
        });
        qc.invalidateQueries({ queryKey: ['document-imports-page'] });
      } catch (e) {
        toast.error(`Échec de l'upload (${file.name}) : ${e.message || e}`);
      }
    }
    // Démarre le premier document de la file (les suivants enchaîneront auto).
    base44.functions.invoke('processDocumentQueue', {})
      .catch((e) => toast.error(`File d'analyse : ${e.message || e}`));
  };

  const onFiles = (ok, allFiles) => {
    if (allFiles && allFiles.length && !ok.length) {
      toast.error('Aucun fichier supporté (PDF, image, doc, csv, xlsx, max 20 Mo).');
      return;
    }
    if (!ok.length) return;
    startIngest(ok);
  };

  const onCommitted = (rec) => {
    setReviewing(null);
    setDismissed((s) => { const n = new Set(s); n.add(rec.id); return n; });
    qc.invalidateQueries({ queryKey: ['document-imports-page'] });
    qc.invalidateQueries({ queryKey: ['documents'] });
    qc.invalidateQueries({ queryKey: ['properties'] });
    qc.invalidateQueries({ queryKey: ['leases'] });
    toast.success('Import validé — données enregistrées dans votre patrimoine');
  };
  const onRejected = (rec) => {
    setReviewing(null);
    qc.invalidateQueries({ queryKey: ['document-imports-page'] });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 md:py-10 space-y-8">
      {/* En-tête */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h1 className="text-2xl md:text-3xl font-display font-semibold tracking-tight">Importer vos documents</h1>
        </div>
        <p className="text-muted-foreground">Déposez vos documents. Patrimo les analyse un par un, dans l'ordre, et ne demande validation que sur les informations incertaines.</p>
        <p className="text-sm text-muted-foreground/80">Pas besoin de les classer.</p>
      </div>

      <DropZone onFiles={onFiles} disabled={!user} />

      <div className="text-xs text-muted-foreground">
        <p className="font-medium text-foreground/70 mb-2">Vous pouvez notamment importer :</p>
        <p className="leading-relaxed">{EXAMPLE_DOCS.join(' • ')}</p>
      </div>

      {/* En cours d'analyse (≤ 1 document à la fois) */}
      {active.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Hourglass className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-medium text-muted-foreground">Analyse en cours</h2>
          </div>
          <div className="space-y-2">
            {active.map((r) => (
              <ImportCard key={r.id} record={r} />
            ))}
          </div>
        </section>
      )}

      {/* En attente dans la file */}
      {queued.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <FileStack className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-muted-foreground">
              En attente ({queued.length})
            </h2>
          </div>
          <div className="space-y-2">
            {queued.map((r) => (
              <ImportCard key={r.id} record={r} queuePosition={queuePositions[r.id]} />
            ))}
          </div>
        </section>
      )}

      {/* À vérifier */}
      {toReview.length > 0 && (
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Info className="w-4 h-4 text-primary" />
            Patrimo a trouvé {toReview.length} document{toReview.length > 1 ? 's' : ''} à valider.
          </div>
          <div className="space-y-2">
            {toReview.map((r) => (
              <ImportCard key={r.id} record={r} onReview={setReviewing} />
            ))}
          </div>
        </section>
      )}

      {/* Imports récents (terminaux) */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-muted-foreground">Imports récents</h2>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground/70 italic">Aucun import pour l'instant.</p>
        ) : (
          <div className="space-y-2">
            {recent.slice(0, 20).map((r) => (
              <ImportCard key={r.id} record={r} onReview={setReviewing} onDismiss={(rec) => setDismissed((s) => { const n = new Set(s); n.add(rec.id); return n; })} />
            ))}
          </div>
        )}
      </section>

      <DocumentImportReviewDialog
        open={!!reviewing}
        onOpenChange={(o) => !o && setReviewing(null)}
        documentImport={reviewing}
        onCommitted={onCommitted}
        onRejected={onRejected}
      />
    </div>
  );
}