import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Trash2, Paperclip } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function JustificatifUploader({ files, onChange }) {
  const [busy, setBusy] = useState(false);

  const handleFiles = async (e) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    setBusy(true);
    try {
      const added = [];
      for (const f of list) {
        const res = await base44.integrations.Core.UploadFile({ file: f });
        added.push({ url: res.file_url, filename: f.name });
      }
      onChange([...files, ...added]);
      toast.success(`${added.length} justificatif(s) ajouté(s)`);
    } catch (err) {
      toast.error(err?.message || 'Échec de l\'envoi du fichier');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md border border-border bg-card cursor-pointer hover:bg-accent">
          <Upload className="w-3.5 h-3.5" />
          {busy ? 'Envoi…' : 'Joindre un justificatif'}
          <input type="file" multiple className="hidden" onChange={handleFiles} disabled={busy} />
        </label>
      </div>
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-xs border border-border rounded-md px-2 py-1.5 bg-card">
              <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <a href={f.url} target="_blank" rel="noreferrer" className="truncate flex-1 hover:underline">{f.filename}</a>
              <button onClick={() => onChange(files.filter((_, idx) => idx !== i))} className="text-rose-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}