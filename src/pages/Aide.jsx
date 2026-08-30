import React, { useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import ReactMarkdown from 'react-markdown';
import { Search, ArrowLeft, ThumbsUp, ThumbsDown, LifeBuoy } from 'lucide-react';
import { HELP_ARTICLES } from '@/lib/helpArticles';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const FEEDBACK_KEY = 'patrimo-help-feedback';
const loadFb = () => { try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY)) || {}; } catch { return {}; } };
const saveFb = (obj) => localStorage.setItem(FEEDBACK_KEY, JSON.stringify(obj));

export default function Aide() {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [feedback, setFeedback] = useState(loadFb);

  const fuse = useMemo(() => new Fuse(HELP_ARTICLES, {
    keys: ['title', 'body', 'category', 'excerpt'],
    includeScore: true,
    threshold: 0.4,
    ignoreLocation: true,
  }), []);

  const results = query
    ? fuse.search(query).map((r) => r.item)
    : HELP_ARTICLES;
  const active = HELP_ARTICLES.find((a) => a.id === activeId);

  const vote = (id, v) => {
    const next = { ...feedback, [id]: v };
    setFeedback(next);
    saveFb(next);
  };

  if (active) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <button onClick={() => setActiveId(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> Tous les articles
        </button>
        <span className="text-xs text-muted-foreground">{active.category}</span>
        <h1 className="text-2xl font-display font-semibold mb-4">{active.title}</h1>
        <div className="help-prose"><ReactMarkdown>{active.body}</ReactMarkdown></div>
        <style>{`
          .help-prose h2{font-size:1.05rem;font-weight:600;margin:1rem 0 .5rem;}
          .help-prose h3{font-weight:600;margin:.8rem 0 .3rem;}
          .help-prose p{margin:.5rem 0;line-height:1.6;}
          .help-prose ul{list-style:disc;padding-left:1.25rem;margin:.5rem 0;}
          .help-prose ol{list-style:decimal;padding-left:1.25rem;margin:.5rem 0;}
          .help-prose li{margin:.25rem 0;}
          .help-prose blockquote{border-left:3px solid hsl(var(--border));padding:.25rem .75rem;color:hsl(var(--muted-foreground));background:hsl(var(--muted));border-radius:.25rem;margin:.75rem 0;}
          .help-prose strong{font-weight:600;}
        `}</style>
        <div className="mt-8 pt-4 border-t border-border flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">Cet article vous a-t-il aidé ?</span>
          <Button
            variant={feedback[active.id] === 'utile' ? 'default' : 'outline'}
            size="sm"
            onClick={() => vote(active.id, 'utile')}
            className="gap-2"
          >
            <ThumbsUp className="w-4 h-4" /> Utile
          </Button>
          <Button
            variant={feedback[active.id] === 'pas_utile' ? 'default' : 'outline'}
            size="sm"
            onClick={() => vote(active.id, 'pas_utile')}
            className="gap-2"
          >
            <ThumbsDown className="w-4 h-4" /> Pas utile
          </Button>
        </div>
        {feedback[active.id] && (
          <p className="text-sm text-emerald-600 mt-2">Merci pour votre retour !</p>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <LifeBuoy className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-display font-semibold">Centre d'aide</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">Trouvez rapidement une réponse à vos questions.</p>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher : quittance, impayé, import…"
          className="pl-9"
        />
      </div>

      <div className="space-y-2">
        {results.map((a) => (
          <button
            key={a.id}
            onClick={() => setActiveId(a.id)}
            className="w-full text-left rounded-xl border border-border bg-card p-4 hover:border-primary/30 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-sm">{a.title}</span>
              <span className="text-xs text-muted-foreground shrink-0">{a.category}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.excerpt}</p>
          </button>
        ))}
        {results.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-muted-foreground">Aucun article pour « {query} ».</p>
            <p className="text-xs text-muted-foreground mt-1">Contactez-nous via le bouton <strong>Support</strong> en bas à droite.</p>
          </div>
        )}
      </div>
    </div>
  );
}