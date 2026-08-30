import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { FolderArchive, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import DocumentsToolbar from '@/components/documents/DocumentsToolbar';
import DocumentCard from '@/components/documents/DocumentCard';
import ExpirationAlerts from '@/components/documents/ExpirationAlerts';
import DocumentUploadDialog from '@/components/documents/DocumentUploadDialog';
import DocumentDetailDialog from '@/components/documents/DocumentDetailDialog';
import DocumentImportsReview from '@/components/documents/DocumentImportsReview';
import { matchDocument, expirationStatus } from '@/lib/documents';
import EmptyState from '@/components/EmptyState';
import { IlloDocuments } from '@/components/illustrations/EmptyIllustrations';
import ExportReportButton from '@/components/dashboard/ExportReportButton';

export default function Documents() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const docsQ = useQuery({
    queryKey: ['documents'],
    queryFn: async () => {
      const res = await base44.functions.invoke('manageDocuments', { op: 'list' });
      const data = res.data || res;
      return { documents: data.documents || [], linkNames: data.linkNames || {} };
    },
  });

  const catalogsQ = useQuery({
    queryKey: ['documents-catalogs'],
    queryFn: async () => {
      const [properties, lots, leases, holders, transactions, impayes] = await Promise.all([
        base44.entities.Property.list(),
        base44.entities.Lot.list(),
        base44.entities.Lease.list(),
        base44.entities.Holder.list(),
        base44.entities.Transaction.list('-updated_date', 200),
        base44.entities.Impaye.list(),
      ]);
      return { properties, lots, leases, holders, transactions, impayes };
    },
  });

  const documents = docsQ.data?.documents || [];
  const linkNames = docsQ.data?.linkNames || {};

  const mutSave = useMutation({
    mutationFn: async ({ id, patch }) => base44.functions.invoke('manageDocuments', { op: 'save', id, ...patch }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); toast.success('Document mis à jour'); setEditing(null); },
    onError: (e) => toast.error('Échec : ' + (e.message || e)),
  });
  const mutValidate = useMutation({
    mutationFn: async (id) => base44.functions.invoke('manageDocuments', { op: 'validate', id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); toast.success('Document validé'); setEditing(null); },
  });
  const mutDelete = useMutation({
    mutationFn: async (id) => base44.functions.invoke('manageDocuments', { op: 'delete', id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); toast.success('Document supprimé'); setEditing(null); },
  });

  const filtered = useMemo(() => {
    if (!docsQ.data) return [];
    return documents
      .filter((d) => typeFilter === 'all' || d.type === typeFilter)
      .filter((d) => {
        if (!expiringOnly) return true;
        const s = expirationStatus(d.expiration_date);
        return s === 'expired' || s === 'soon';
      })
      .filter((d) => matchDocument(d, search, linkNames))
      .sort((a, b) => String(a.document_date || a.created_date || '').localeCompare(String(b.document_date || b.created_date || ''), undefined, { numeric: true }) * -1);
  }, [documents, typeFilter, expiringOnly, search, linkNames, docsQ.data]);

  const expiringCount = useMemo(() => documents.filter((d) => {
    const s = expirationStatus(d.expiration_date); return s === 'expired' || s === 'soon';
  }).length, [documents]);

  const handleAlertFilter = (kind) => {
    setExpiringOnly(true);
    setTypeFilter('all');
    setSearch('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><FolderArchive className="w-5 h-5" /> Coffre documentaire</h1>
          <p className="text-sm text-muted-foreground">Tous vos documents reliés aux biens, lots, baux, locataires, prêts, détenteurs, transactions et impayés. Expiration et IA intégrées.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportReportButton />
          <Button onClick={() => setUploadOpen(true)}><Plus className="w-4 h-4 mr-1" />Importer un document</Button>
        </div>
      </div>

      <ExpirationAlerts documents={documents} onFilter={handleAlertFilter} />
      <DocumentImportsReview />
      <DocumentsToolbar search={search} setSearch={setSearch} typeFilter={typeFilter} setTypeFilter={setTypeFilter} expiringOnly={expiringOnly} setExpiringOnly={setExpiringOnly} count={expiringCount} />

      {docsQ.isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        documents.length === 0 ? (
          <EmptyState
            illustration={<IlloDocuments />}
            title="Coffre documentaire vide"
            subtitle="Uploadez vos documents clés pour tout retrouver au bon moment et ne rien laisser expirer."
            primary={<Button onClick={() => setUploadOpen(true)} className="gap-2"><Plus className="w-4 h-4" />Ajouter un document</Button>}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              {['DPE', 'Assurance PNO', 'Bail signé', 'Quittances', 'Taxe foncière'].map((d) => (
                <span key={d} className="flex items-center gap-1.5 justify-center"><span className="w-1 h-1 rounded-full bg-accent" />{d}</span>
              ))}
            </div>
          </EmptyState>
        ) : (
          <div className="text-center py-12 text-sm text-muted-foreground">Aucun document ne correspond à votre recherche.</div>
        )
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((d) => (
            <DocumentCard key={d.id} doc={d} linkNames={linkNames} onOpen={(doc) => setEditing(doc)} />
          ))}
        </div>
      )}

      <DocumentUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onCreated={(rec) => { qc.invalidateQueries({ queryKey: ['documents'] }); setEditing(rec); }} />
      <DocumentDetailDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        doc={editing}
        catalogs={catalogsQ.data}
        onSave={(patch) => mutSave.mutate({ id: editing?.id, patch })}
        onValidate={() => mutValidate.mutate(editing?.id)}
        onDelete={() => mutDelete.mutate(editing?.id)}
      />
    </div>
  );
}