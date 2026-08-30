import React from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Search, Filter } from 'lucide-react';
import { TYPE_LIST, TYPE_LABELS } from '@/lib/documents';

export default function DocumentsToolbar({ search, setSearch, typeFilter, setTypeFilter, expiringOnly, setExpiringOnly, count }) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher : titre, type, tag, fournisseur, bien, locataire…"
          className="pl-9"
        />
      </div>
      <Select value={typeFilter} onValueChange={setTypeFilter}>
        <SelectTrigger className="w-full sm:w-48"><Filter className="w-4 h-4 mr-2 text-muted-foreground" /><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les types</SelectItem>
          {TYPE_LIST.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
        </SelectContent>
      </Select>
      <button
        onClick={() => setExpiringOnly(!expiringOnly)}
        className={`px-3 h-9 rounded-md border text-sm font-medium transition-colors whitespace-nowrap ${expiringOnly ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-background hover:bg-accent'}`}
      >
        Expirants {count > 0 && `(${count})`}
      </button>
    </div>
  );
}