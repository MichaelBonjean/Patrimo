import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Bell, Plus } from 'lucide-react';
import { toast } from 'sonner';

function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDaysISO(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const QUICK = [
  { label: "Aujourd'hui", get: () => todayISO() },
  { label: 'Demain', get: () => addDaysISO(todayISO(), 1) },
  { label: 'Dans 3 j', get: () => addDaysISO(todayISO(), 3) },
  { label: 'Dans 7 j', get: () => addDaysISO(todayISO(), 7) },
];

export default function PersonalReminderDialog({ open, onOpenChange, properties = [] }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('normal');
  const [saving, setSaving] = useState(false);

  const reset = () => { setTitle(''); setNote(''); setDueDate(''); setPriority('normal'); };

  const submit = async () => {
    if (!title.trim()) { toast.error('Indiquez un intitulé de rappel.'); return; }
    setSaving(true);
    try {
      const res = await base44.functions.invoke('manageReminders', {
        op: 'create', title: title.trim(), note: note.trim() || undefined,
        due_date: dueDate || undefined, priority,
      });
      if (res?.data?.error) throw new Error(res.data.error);
      toast.success('Rappel noté ✏️');
      qc.invalidateQueries({ queryKey: ['personal-reminders'] });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(e.message || 'Impossible d\'enregistrer le rappel');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={( o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle>Noter un rappel personnel</DialogTitle>
              <DialogDescription>Pour ne rien oublier — visible sur votre tableau de bord.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="pr-title">Intitulé</Label>
            <Input id="pr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex : Appeler le locataire pour le chauffe-eau" />
          </div>

          <div className="space-y-1.5">
            <Label>Échéance</Label>
            <div className="flex flex-wrap gap-2">
              {QUICK.map((q) => (
                <button key={q.label} type="button"
                  onClick={() => setDueDate(q.get())}
                  className={`px-3 h-9 rounded-full text-xs font-medium border transition-colors ${
                    dueDate === q.get() ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'
                  }`}>
                  {q.label}
                </button>
              ))}
            </div>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-priority">Priorité</Label>
            <div className="flex gap-2">
              {[['low', 'Basse'], ['normal', 'Normale'], ['high', 'Haute']].map(([v, l]) => (
                <button key={v} type="button"
                  onClick={() => setPriority(v)}
                  className={`px-3 h-9 rounded-md text-xs font-medium border transition-colors ${
                    priority === v ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'
                  }`}>{l}</button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pr-note">Note (optionnel)</Label>
            <Textarea id="pr-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Détail, contexte…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={saving} className="gap-2">
            <Plus className="w-4 h-4" /> {saving ? 'Enregistrement…' : 'Noter le rappel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}