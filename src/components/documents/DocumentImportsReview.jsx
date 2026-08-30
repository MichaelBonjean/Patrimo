import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Sparkles, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DocumentImportReviewDialog from '@/components/documents/DocumentImportReviewDialog';

// Liste les DocumentImport en attente de validation (pipeline « Document First »).
// Affiché au-dessus du coffre documentaire quand l’IA a des propositions à valider.
export default function DocumentImportsReview() {
  const qc = useQueryClient();
  const [reviewing, setReviewing] = useState(null);

  const q = useQuery({
    queryKey: ['document-imports-awaiting'],
    queryFn: async () => {
      const res = await base44.entities.DocumentImport.filter({ status: 'awaiting_review' });
      const list = Array.isArray(res) ? res : (res?.items || []);
      return list.sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
    },
    refetchInterval: 15000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['document-imports-awaiting'] });
    qc.invalidateQueries({ queryKey: ['documents'] });
  };

  const items = q.data || [];

  if (q.isLoading) return null;
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">À valider par l’IA</span>
        <Badge className="ml-1">{items.length}</Badge>
      </div>
      <div className="space-y-1.5">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setReviewing(it)}
            className="w-full flex items-center gap-2 text-left text-xs rounded-md border bg-card hover:bg-accent transition-colors p-2"
          >
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="truncate font-medium">{it.file_name}</span>
            <Badge variant="secondary" className="text-[10px] ml-auto">{it.classification || '—'}</Badge>
          </button>
        ))}
      </div>

      <DocumentImportReviewDialog
        open={!!reviewing}
        onOpenChange={(o) => !o && setReviewing(null)}
        documentImport={reviewing}
        onCommitted={() => { setReviewing(null); invalidate(); }}
        onRejected={() => { setReviewing(null); invalidate(); }}
      />
    </div>
  );
}