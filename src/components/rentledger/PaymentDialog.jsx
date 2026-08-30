import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

const PAYER_TYPES = [
  { value: 'tenant', label: 'Locataire' },
  { value: 'caf', label: 'CAF / APL' },
  { value: 'guarantor', label: 'Garant' },
  { value: 'insurance', label: 'Assurance loyers impayés' },
  { value: 'other', label: 'Autre' },
];

const METHODS = ['virement', 'chèque', 'espèces', 'prélèvement', 'caf', 'cb', 'autre'];

export default function PaymentDialog({ open, onClose, leaseId, defaultAmount }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [payerType, setPayerType] = useState('tenant');
  const [payerName, setPayerName] = useState('');
  const [method, setMethod] = useState('virement');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && defaultAmount) setAmount(String(defaultAmount));
  }, [open, defaultAmount]);

  async function submit() {
    if (!leaseId) return;
    if (!date || !amount || Number(amount) <= 0) {
      toast.error('Renseignez une date et un montant positif');
      return;
    }
    setBusy(true);
    try {
      await base44.functions.invoke('recordPayment', {
        lease_id: leaseId,
        date,
        amount: Number(amount),
        payer_type: payerType,
        payer_name: payerName,
        method,
        reference,
        notes,
      });
      toast.success('Paiement enregistré');
      reset();
      onClose(true);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Erreur lors de l\'enregistrement';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setAmount('');
    setPayerName('');
    setReference('');
    setNotes('');
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Encaisser un loyer</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date du paiement</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Montant (€)</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="650,00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Payeur</Label>
              <Select value={payerType} onValueChange={setPayerType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYER_TYPES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Moyen de paiement</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Nom du payeur (optionnel)</Label>
            <Input value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="Nom qui apparaît dans la quittance" />
          </div>
          <div>
            <Label>Référence (optionnel)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° de chèque, de virement…" />
          </div>
          <div>
            <Label>Notes (optionnel)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Sans affectation manuelle, le paiement est réparti automatiquement sur les échéances les plus anciennes.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={busy}>Annuler</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}