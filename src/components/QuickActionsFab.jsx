import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Building2, Wallet, UserPlus, UploadCloud } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import QuickTenantForm from '@/components/QuickTenantForm';

const ACTIONS = [
  { key: 'documents', icon: UploadCloud, title: 'Importer des documents', desc: 'Donnez vos documents à Patrimo — il récupère les infos', color: 'bg-primary/10 text-primary', to: '/import', primary: true },
  { key: 'property', icon: Building2, title: 'Ajouter un bien', desc: 'Créez un nouveau bien dans votre patrimoine', color: 'bg-blue-100 text-blue-600', to: '/biens/nouveau' },
  { key: 'payment', icon: Wallet, title: 'Saisir un paiement', desc: 'Enregistrez un encaissement manuellement', color: 'bg-emerald-100 text-emerald-600', to: '/banque?tab=manuel' },
  { key: 'tenant', icon: UserPlus, title: 'Ajouter un locataire', desc: 'Associez un locataire à un lot', color: 'bg-violet-100 text-violet-600', modal: true },
];

export default function QuickActionsFab() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tenantOpen, setTenantOpen] = useState(false);

  // Signale l'état ouvert au SupportFab pour qu'il se cache.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('qa-fab-open', { detail: open }));
  }, [open]);

  const handle = (action) => {
    setOpen(false);
    if (action.modal) { setTenantOpen(true); return; }
    navigate(action.to);
  };

  return (
    <>
      <button
        type="button"
        aria-label="Actions rapides"
        onClick={() => setOpen(true)}
        className="md:hidden fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform"
      >
        <Plus className="h-6 w-6" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl px-4 pb-6 pt-3">
          <SheetHeader className="text-center">
            <SheetTitle>Actions rapides</SheetTitle>
            <SheetDescription className="sr-only">Choisissez une action rapide</SheetDescription>
          </SheetHeader>
          <div className="mt-2 space-y-3">
            {ACTIONS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => handle(a)}
                className="w-full h-[72px] flex items-center gap-4 rounded-xl border border-border bg-card px-4 text-left hover:bg-accent transition-colors"
              >
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${a.color}`}>
                  <a.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${a.primary ? 'font-semibold text-primary' : 'font-medium'}`}>{a.title}</span>
                  <span className="block text-xs text-muted-foreground truncate">{a.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <QuickTenantForm open={tenantOpen} onClose={() => setTenantOpen(false)} />
    </>
  );
}