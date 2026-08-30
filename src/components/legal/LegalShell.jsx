import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LEGAL_DOCS, EDITOR } from '@/lib/legalDocs';

// Coque publique commune aux 4 pages légales : en-tête (logo + retour),
// contenu, pied de page avec liens croisés + version/hash du document.
export default function LegalShell({ docKey, title, children, maxWidth = '3xl' }) {
  const meta = LEGAL_DOCS[docKey];
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <style>{`
        .legal-prose h2 { font-family: var(--font-display); font-size: 1.3rem; font-weight: 600; margin: 1.75rem 0 0.5rem; color: hsl(var(--foreground)); }
        .legal-prose h3 { font-size: 1.02rem; font-weight: 600; margin: 1.1rem 0 0.25rem; color: hsl(var(--foreground)); }
        .legal-prose p { margin: 0.5rem 0; line-height: 1.65; color: hsl(var(--foreground)/0.85); }
        .legal-prose ul { list-style: disc; padding-left: 1.3rem; margin: 0.5rem 0; }
        .legal-prose ol { list-style: decimal; padding-left: 1.3rem; margin: 0.5rem 0; }
        .legal-prose li { margin: 0.3rem 0; line-height: 1.55; color: hsl(var(--foreground)/0.85); }
        .legal-prose strong { font-weight: 600; color: hsl(var(--foreground)); }
        .legal-prose a { color: hsl(var(--primary)); text-decoration: underline; }
        .legal-prose .legal-grid { display: grid; gap: 0.4rem 0.5rem; }
        .legal-table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.85rem; }
        .legal-table th, .legal-table td { border: 1px solid hsl(var(--border)); padding: 0.45rem 0.55rem; text-align: left; vertical-align: top; }
        .legal-table th { background: hsl(var(--muted)); font-weight: 600; }
      `}</style>
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className={`max-w-${maxWidth} mx-auto px-4 py-3 flex items-center justify-between`}>
          <Link to="/landing" className="font-display text-xl font-semibold text-primary">Patrimo</Link>
          <button onClick={() => navigate(-1)} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Retour
          </button>
        </div>
      </header>
      <main className={`max-w-${maxWidth} mx-auto px-4 py-6 flex-1 w-full`}>
        <h1 className="text-3xl font-display font-semibold mb-1">{title}</h1>
        <p className="text-xs text-muted-foreground mb-6">Document contractuel — en vigueur au {new Date(meta.version).toLocaleDateString('fr-FR')}</p>
        <div className="legal-prose max-w-none">{children}</div>
      </main>
      <footer className="border-t border-border bg-card mt-8">
        <div className="max-w-3xl mx-auto px-4 py-6 text-xs text-muted-foreground space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link to="/cgu" className="hover:text-foreground">CGU</Link>
            <Link to="/mentions-legales" className="hover:text-foreground">Mentions légales</Link>
            <Link to="/confidentialite" className="hover:text-foreground">Confidentialité</Link>
            <Link to="/dpa" className="hover:text-foreground">Sous-traitance (DPA)</Link>
          </div>
          <div className="text-muted-foreground/70">
            Version {meta.version} · {meta.hash} · édité par {EDITOR.editor_name}.
          </div>
          <p className="text-muted-foreground/60">
            Ce document est fourni à titre de modèle de conformité minimale. Il doit être relu par un avocat
            spécialisé en droit des données avant toute mise en ligne effective.
          </p>
        </div>
      </footer>
    </div>
  );
}