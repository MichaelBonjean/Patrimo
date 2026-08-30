import React, { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ACCEPTED_MIME, isAcceptable } from '@/lib/importerPipeline';

/**
 * Grande zone de dépôt drag & drop, aérée et premium.
 * Gère le multi-fichiers sans demander le type de document.
 */
export default function DropZone({ onFiles, disabled }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files || []);
    const ok = files.filter(isAcceptable);
    if (ok.length) onFiles?.(ok);
    else if (files.length) onFiles?.([], files);
  };

  const handlePick = (e) => {
    const files = Array.from(e.target.files || []);
    const ok = files.filter(isAcceptable);
    if (ok.length) onFiles?.(ok);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'relative flex flex-col items-center justify-center text-center gap-4 rounded-2xl border-2 border-dashed transition-all px-6 py-14 cursor-pointer',
        dragging ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/50 hover:bg-muted/40',
        disabled && 'opacity-60 pointer-events-none'
      )}
    >
      <input ref={inputRef} type="file" multiple accept={ACCEPTED_MIME} onChange={handlePick} className="hidden" />
      <span className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary">
        <UploadCloud className="w-8 h-8" />
      </span>
      <div className="space-y-1">
        <p className="text-lg font-semibold">Déposez vos documents ici</p>
        <p className="text-sm text-muted-foreground">Actes, bails, prêts, relevés… plusieurs fichiers à la fois</p>
      </div>
      <span className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground h-10 px-5 text-sm font-medium">
        Choisir mes fichiers
      </span>
      <p className="text-xs text-muted-foreground">PDF • JPG • PNG • autres formats supportés</p>
    </div>
  );
}