import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileText, CheckCircle, Loader2, Edit3, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOwnerFilter, withOwnerEmail } from '@/lib/tenantFilter';

const DOC_TYPES = [
  { value: 'invoice', label: '🧾 Facture', desc: 'Montant, fournisseur, date, TVA' },
  { value: 'lease', label: '📋 Bail de location', desc: 'Locataire, loyer, charges, dépôt' },
  { value: 'deed', label: '🏠 Acte / Compromis', desc: 'Prix, adresse, surface, frais notaire' },
  { value: 'loan', label: '🏦 Édition de prêt', desc: 'Montant, durée, taux, mensualité' },
  { value: 'sci', label: '🏢 SCI', desc: 'Statuts, capital, SIRET, infos' },
  { value: 'dpe', label: '🌿 DPE', desc: 'Classe DPE/GES, consommation, date' },
];

const SCHEMAS = {
  invoice: {
    type: 'object',
    properties: {
      supplier_name: { type: 'string', description: "Nom du fournisseur / prestataire" },
      invoice_date: { type: 'string', description: "Date de la facture (YYYY-MM-DD)" },
      invoice_number: { type: 'string', description: "Numéro de facture" },
      amount_ht: { type: 'number', description: "Montant HT en euros" },
      tva: { type: 'number', description: "TVA en euros" },
      amount_ttc: { type: 'number', description: "Montant TTC en euros" },
      description: { type: 'string', description: "Description des prestations" },
      category_suggestion: { type: 'string', description: "Catégorie parmi : Travaux, Entretien, Frais gestion, Comptable, Banque, Assurance habitation, PNO, Copropriété, Électricité, Eau, Gaz, Internet, Autres charges" },
    }
  },
  lease: {
    type: 'object',
    properties: {
      tenant_name: { type: 'string', description: "Nom complet du locataire" },
      tenant_email: { type: 'string', description: "Email locataire" },
      tenant_phone: { type: 'string', description: "Téléphone locataire" },
      tenant_entry_date: { type: 'string', description: "Date d'entrée (YYYY-MM-DD)" },
      rent_excluding_charges: { type: 'number', description: "Loyer hors charges en euros" },
      charges: { type: 'number', description: "Charges mensuelles en euros" },
      deposit: { type: 'number', description: "Dépôt de garantie en euros" },
      lease_type: { type: 'string', description: "Type de bail : Vide-Nu, Meublé, Bail commercial, etc." },
      designation: { type: 'string', description: "Désignation / description du logement" },
      surface: { type: 'number', description: "Surface en m²" },
      typology: { type: 'string', description: "Typologie : Studio, T1, T2, T3, etc." },
      floor: { type: 'string', description: "Étage du logement" },
      code: { type: 'string', description: "Code ou référence du lot" },
    }
  },
  deed: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "Nom/désignation du bien" },
      address: { type: 'string', description: "Adresse complète" },
      postal_code: { type: 'string', description: "Code postal" },
      city: { type: 'string', description: "Ville" },
      purchase_price: { type: 'number', description: "Prix de vente en euros" },
      notary_fees: { type: 'number', description: "Frais de notaire en euros" },
      agency_fees: { type: 'number', description: "Frais d'agence en euros" },
      acquisition_date: { type: 'string', description: "Date d'acquisition (YYYY-MM-DD)" },
      total_surface: { type: 'number', description: "Surface totale m²" },
      holding_structure: { type: 'string', description: "Structure : En propre, SCI, SARL, etc." },
      category: { type: 'string', description: "Catégorie : Maison, Appartement, Immeuble, Local commercial, etc." },
    }
  },
  loan: {
    type: 'object',
    properties: {
      bank: { type: 'string', description: "Nom de la banque" },
      loan_amount: { type: 'number', description: "Montant emprunté en euros" },
      loan_rate: { type: 'number', description: "Taux annuel en % (ex: 3.5)" },
      loan_duration_years: { type: 'number', description: "Durée en années" },
      monthly_payment: { type: 'number', description: "Mensualité hors assurance en euros" },
      monthly_insurance: { type: 'number', description: "Assurance prêt mensuelle en euros" },
      loan_start_date: { type: 'string', description: "Date de début du prêt (YYYY-MM-DD)" },
      remaining_capital: { type: 'number', description: "Capital restant dû en euros si mentionné" },
    }
  },
  dpe: {
    type: 'object',
    properties: {
      dpe_class: { type: 'string', description: "Classe DPE (A à G)" },
      ges_class: { type: 'string', description: "Classe GES (A à G)" },
      energy_consumption: { type: 'number', description: "Consommation énergie en kWh/m²/an" },
      dpe_date: { type: 'string', description: "Date du DPE (YYYY-MM-DD)" },
      surface: { type: 'number', description: "Surface du logement en m²" },
      designation: { type: 'string', description: "Adresse ou description du logement" },
    }
  },
  sci: {
    type: 'object',
    properties: {
      sci_name: { type: 'string', description: "Dénomination sociale de la SCI" },
      sci_siret: { type: 'string', description: "SIRET de la SCI" },
      sci_capital: { type: 'number', description: "Capital social en euros" },
      sci_creation_date: { type: 'string', description: "Date de création (YYYY-MM-DD)" },
      sci_bank: { type: 'string', description: "Banque de la société" },
      beneficiaries: {
        type: 'array',
        description: "Liste des bénéficiaires/associés (personnes physiques)",
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: "Nom complet" },
            email: { type: 'string', description: "Email" },
            phone: { type: 'string', description: "Téléphone" },
            address: { type: 'string', description: "Adresse" },
            shares_number: { type: 'number', description: "Nombre de parts sociales" },
            share_percent: { type: 'number', description: "Part en % (ex: 50 pour 50%)" },
          }
        }
      }
    }
  }
};

const FIELD_LABELS = {
  invoice: [
    ['supplier_name', 'Fournisseur'], ['invoice_date', 'Date', 'date'], ['invoice_number', 'N° facture'],
    ['amount_ht', 'Montant HT (€)', 'number'], ['tva', 'TVA (€)', 'number'], ['amount_ttc', 'Montant TTC (€)', 'number'],
    ['description', 'Description'], ['category_suggestion', 'Catégorie suggérée'],
  ],
  lease: [
    ['tenant_name', 'Locataire'], ['tenant_email', 'Email'], ['tenant_phone', 'Téléphone'],
    ['tenant_entry_date', 'Date entrée', 'date'], ['rent_excluding_charges', 'Loyer HC (€)', 'number'],
    ['charges', 'Charges (€)', 'number'], ['deposit', 'Dépôt garantie (€)', 'number'],
    ['lease_type', 'Type bail'], ['surface', 'Surface m²', 'number'],
    ['typology', 'Typologie'], ['floor', 'Étage'], ['code', 'Code lot'],
  ],
  deed: [
    ['name', 'Nom du bien'],
    ['address', 'Adresse'], ['postal_code', 'CP'], ['city', 'Ville'],
    ['purchase_price', 'Prix achat (€)', 'number'], ['notary_fees', 'Frais notaire (€)', 'number'],
    ['agency_fees', "Frais agence (€)", 'number'], ['acquisition_date', 'Date acquisition', 'date'],
    ['total_surface', 'Surface m²', 'number'], ['holding_structure', 'Structure'], ['category', 'Catégorie bien'],
  ],
  loan: [
    ['bank', 'Banque'], ['loan_amount', 'Montant prêt (€)', 'number'],
    ['loan_rate', 'Taux (%)', 'number'], ['loan_duration_years', 'Durée (ans)', 'number'],
    ['monthly_payment', 'Mensualité HC ass. (€)', 'number'], ['monthly_insurance', 'Assurance/mois (€)', 'number'],
    ['loan_start_date', 'Début prêt', 'date'], ['remaining_capital', 'CRD (€)', 'number'],
  ],
  dpe: [
    ['dpe_class', 'Classe DPE'], ['ges_class', 'Classe GES'],
    ['energy_consumption', 'Consommation (kWh/m²/an)', 'number'], ['dpe_date', 'Date DPE', 'date'],
    ['surface', 'Surface m²', 'number'], ['designation', 'Adresse / logement'],
  ],
  sci: [
    ['sci_name', 'Dénomination'], ['sci_siret', 'SIRET'], ['sci_capital', 'Capital (€)', 'number'],
    ['sci_creation_date', 'Date création', 'date'], ['sci_bank', 'Banque'],
  ],
};

function FieldRow({ label, value, onChange, type = 'text', readOnly = false }) {
  return (
    <div className="grid grid-cols-5 gap-2 items-center">
      <Label className="text-xs text-muted-foreground col-span-2">{label}</Label>
      {readOnly ? (
        <div className="col-span-3 h-7 text-xs px-3 flex items-center bg-muted/50 border border-border rounded-md text-muted-foreground italic">{value ?? '–'}</div>
      ) : (
        <Input className="col-span-3 h-7 text-xs" type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  );
}

const MAX_DOCS = 10;

export default function DocumentImporter({ properties, lots, onClose }) {
  const queryClient = useQueryClient();
  const { ownerEmail } = useOwnerFilter();
  const fileRef = useRef(null);
  // steps: 'upload' | 'analyzing' | 'review' | 'done'
  const [step, setStep] = useState('upload');
  const [uploads, setUploads] = useState([]); // Array of { file, docType, extracted, status, error, leaseAction, deedAction, propertyId, lotId }
  const [currentIndex, setCurrentIndex] = useState(0);
  const [analyzeProgress, setAnalyzeProgress] = useState({ done: 0, total: 0 });
  const [tooManyDocs, setTooManyDocs] = useState(false);

  const currentUpload = uploads[currentIndex];

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) addFiles(files);
  };

  const handleFile = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) addFiles(files);
    if (fileRef.current) fileRef.current.value = '';
  };

  const addFiles = (files) => {
    setUploads(prev => {
      if (prev.length + files.length > MAX_DOCS) {
        setTooManyDocs(true);
        return prev;
      }
      const newUploads = files.map(file => ({
        file,
        docType: prev[0]?.docType || 'invoice',
        extracted: null,
        status: 'pending', // 'pending' | 'analyzing' | 'done' | 'error'
        error: null,
        leaseAction: null,
        deedAction: null,
        propertyId: '',
        lotId: '',
      }));
      return [...prev, ...newUploads];
    });
  };

  const updateUpload = (index, updates) => {
    setUploads(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  };

  const updateCurrentUpload = (updates) => updateUpload(currentIndex, updates);

  const analyzeAll = async () => {
    setStep('analyzing');
    setAnalyzeProgress({ done: 0, total: uploads.length });

    const results = await Promise.allSettled(
      uploads.map(async (upload, i) => {
        try {
          const { file_url } = await base44.integrations.Core.UploadFile({ file: upload.file });
          const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
            file_url,
            json_schema: SCHEMAS[upload.docType],
          });
          if (result.status === 'success') {
            const extracted = Array.isArray(result.output) ? result.output[0] : result.output;
            return { index: i, extracted };
          } else {
            throw new Error(result.details || 'erreur inconnue');
          }
        } finally {
          setAnalyzeProgress(prev => ({ ...prev, done: prev.done + 1 }));
        }
      })
    );

    setUploads(prev => {
      const next = [...prev];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          next[i] = { ...next[i], extracted: r.value.extracted, status: 'done' };
        } else {
          next[i] = { ...next[i], status: 'error', error: r.reason?.message || 'Erreur' };
        }
      });
      return next;
    });

    setCurrentIndex(0);
    setStep('review');
  };

  const applyMutation = useMutation({
    mutationFn: async () => {
      const upload = currentUpload;
      const docType = upload.docType;
      const propertyId = upload.propertyId;
      const lotId = upload.lotId;
      const extracted = upload.extracted;
      const leaseAction = upload.leaseAction;
      const deedAction = upload.deedAction;

      if (docType === 'sci') {
        // Create SCITemplate from extracted data
        const sciData = {
          sci_name: extracted.sci_name,
          sci_siret: extracted.sci_siret,
          sci_capital: extracted.sci_capital,
          sci_creation_date: extracted.sci_creation_date,
          sci_bank: extracted.sci_bank,
        };
        const sciCreated = await base44.entities.SCITemplate.create(sciData);
        
        // Create or link beneficiary holders if provided
        if (extracted.beneficiaries && Array.isArray(extracted.beneficiaries)) {
          // Fetch existing holders
          const existingHolders = await base44.entities.Holder.filter(withOwnerEmail(ownerEmail));
          
          for (const beneficiary of extracted.beneficiaries) {
            if (beneficiary.name) {
              // Check if this person already exists
              const existingHolder = existingHolders.find(h => 
                h.type === 'Personne physique' && 
                h.name?.toLowerCase() === beneficiary.name?.toLowerCase()
              );
              
              if (existingHolder) {
                // Update existing holder with new data if needed
                await base44.entities.Holder.update(existingHolder.id, {
                  parent_holder_id: sciCreated?.id,
                  sub_share_percent: beneficiary.share_percent,
                  email: beneficiary.email || existingHolder.email,
                  phone: beneficiary.phone || existingHolder.phone,
                  address: beneficiary.address || existingHolder.address,
                });
              } else {
                // Create new holder
                await base44.entities.Holder.create({
                  owner_id: ownerEmail,
                  name: beneficiary.name,
                  type: 'Personne physique',
                  email: beneficiary.email,
                  phone: beneficiary.phone,
                  address: beneficiary.address,
                  parent_holder_id: sciCreated?.id,
                  sub_share_percent: beneficiary.share_percent,
                });
              }
            }
          }
        }
        
        queryClient.invalidateQueries({ queryKey: ['sci-templates'] });
        queryClient.invalidateQueries({ queryKey: ['holders'] });
        return;
      }

      if (docType === 'invoice' && propertyId) {
        const d = new Date(extracted.invoice_date || new Date());
        await base44.entities.BankImport.create({
          owner_id: ownerEmail,
          import_date: extracted.invoice_date || new Date().toISOString().slice(0, 10),
          description: `${extracted.supplier_name || 'Facture'} – ${extracted.description || ''}`,
          amount: -(Math.abs(extracted.amount_ttc || extracted.amount_ht || 0)),
          status: 'categorized',
          assigned_property_id: propertyId,
          assigned_lot_id: lotId || '',
          assigned_category: extracted.category_suggestion || 'Autres charges',
          batch_id: 'doc-import-' + new Date().toISOString(),
        });
        await base44.entities.Transaction.create({
          owner_id: ownerEmail,
          property_id: propertyId,
          lot_id: lotId || undefined,
          year: d.getFullYear(),
          month: d.getMonth() + 1,
          category: extracted.category_suggestion || 'Autres charges',
          amount: Math.abs(extracted.amount_ttc || extracted.amount_ht || 0),
          type: 'expense',
          note: `${extracted.supplier_name || ''} – ${extracted.invoice_number || ''} – ${extracted.description || ''}`,
        });
        queryClient.invalidateQueries({ queryKey: ['bank-imports'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });

      } else if (docType === 'lease') {
        // Données uniquement locataire (pour mise à jour d'un lot existant)
        const tenantOnlyData = {
          tenant_name: extracted.tenant_name,
          tenant_email: extracted.tenant_email,
          tenant_phone: extracted.tenant_phone,
          tenant_entry_date: extracted.tenant_entry_date,
          rent_excluding_charges: extracted.rent_excluding_charges,
          charges: extracted.charges,
          deposit: extracted.deposit,
          lease_type: extracted.lease_type,
          is_vacant: false,
        };
        // Données complètes pour création d'un nouveau lot
        const fullLeaseData = {
          ...tenantOnlyData,
          surface: extracted.surface,
          designation: extracted.designation,
          typology: extracted.typology,
          floor: extracted.floor,
          code: extracted.code,
          property_id: propertyId,
        };
        if (leaseAction === 'create_new_property') {
          const newProperty = await base44.entities.Property.create({
            owner_id: ownerEmail,
            name: upload.newPropertyName,
            category: 'Appartement',
            holding_structure: 'En propre',
            tax_regime: 'Location nue (revenus fonciers)',
          });
          await base44.entities.Lot.create({ owner_id: ownerEmail, ...fullLeaseData, property_id: newProperty.id });
          queryClient.invalidateQueries({ queryKey: ['properties'] });
        } else if (leaseAction === 'update_existing' && lotId) {
          // Uniquement les infos locataire, jamais la désignation ni les caractéristiques du lot
          await base44.entities.Lot.update(lotId, tenantOnlyData);
        }
        queryClient.invalidateQueries({ queryKey: ['lots'] });

      } else if (docType === 'deed') {
        const deedData = {
          name: extracted.name,
          address: extracted.address,
          postal_code: extracted.postal_code,
          city: extracted.city,
          purchase_price: extracted.purchase_price,
          notary_fees: extracted.notary_fees,
          agency_fees: extracted.agency_fees,
          acquisition_date: extracted.acquisition_date,
          total_surface: extracted.total_surface,
          holding_structure: extracted.holding_structure,
          category: extracted.category,
          tax_regime: 'Location nue (revenus fonciers)',
        };
        if (deedAction === 'create') {
          await base44.entities.Property.create({ owner_id: ownerEmail, ...deedData });
        } else if (deedAction === 'update' && propertyId) {
          await base44.entities.Property.update(propertyId, deedData);
        }
        queryClient.invalidateQueries({ queryKey: ['properties'] });

      } else if (docType === 'dpe' && lotId) {
        await base44.entities.Lot.update(lotId, {
          dpe_class: extracted.dpe_class,
          ges_class: extracted.ges_class,
          energy_consumption: extracted.energy_consumption,
          dpe_date: extracted.dpe_date,
          ...(extracted.surface && { surface: extracted.surface }),
        });
        queryClient.invalidateQueries({ queryKey: ['lots'] });

      } else if (docType === 'loan' && propertyId) {
        await base44.entities.Property.update(propertyId, {
          bank: extracted.bank,
          loan_amount: extracted.loan_amount,
          loan_rate: extracted.loan_rate,
          loan_duration_years: extracted.loan_duration_years,
          monthly_payment: extracted.monthly_payment,
          monthly_insurance: extracted.monthly_insurance,
          loan_start_date: extracted.loan_start_date,
          remaining_capital: extracted.remaining_capital,
        });
        queryClient.invalidateQueries({ queryKey: ['properties'] });
      }
    },
    onSuccess: () => {
      if (currentIndex < uploads.length - 1) {
        setCurrentIndex(prev => prev + 1);
        toast.success('Document importé. Passage au suivant...');
      } else {
        toast.success('Tous les documents ont été importés');
        setStep('done');
      }
    },
    onError: (error) => toast.error(error?.response?.data?.message || error?.message || 'Erreur lors de l\'enregistrement'),
  });

  const setField = (key, val) => {
    updateCurrentUpload({
      extracted: { ...currentUpload.extracted, [key]: val }
    });
  };

  const propLots = currentUpload ? lots.filter(l => l.property_id === currentUpload.propertyId) : [];

  // Auto-select lot if property has only one
  const autoSelectLotIfSingle = (propertyId) => {
    const lotsForProp = lots.filter(l => l.property_id === propertyId);
    if (lotsForProp.length === 1) return lotsForProp[0].id;
    return '';
  };

  const getSubmitError = () => {
    if (!currentUpload) return 'Aucun document sélectionné';
    const { docType, propertyId, lotId, leaseAction, deedAction } = currentUpload;
    if (docType === 'invoice' && !propertyId) return 'Sélectionnez le bien concerné';
    if (docType === 'loan' && !propertyId) return 'Sélectionnez le bien concerné';
    if (docType === 'lease') {
      if (!leaseAction) return 'Choisissez de créer un nouveau bien ou de mettre à jour un bien existant';
      if (leaseAction === 'create_new_property' && !(currentUpload.newPropertyName || '').trim()) return 'Indiquez le nom du nouveau bien';
      if (leaseAction === 'update_existing' && !lotId) return 'Sélectionnez le bien et le lot à mettre à jour';
    }
    if (docType === 'deed') {
      if (!deedAction) return 'Choisissez de créer un nouveau bien ou de mettre à jour un bien existant';
      if (deedAction === 'create' && !(currentUpload.extracted?.name || '').trim()) return 'Indiquez le nom du nouveau bien';
      if (deedAction === 'update' && !propertyId) return 'Sélectionnez le bien à mettre à jour';
    }
    if (docType === 'sci' && !currentUpload.extracted?.sci_name) return 'Le nom de la SCI est requis';
    if (docType === 'dpe' && !lotId) return 'Sélectionnez le lot concerné';
    return null;
  };

  const canSubmit = () => getSubmitError() === null;

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      {/* Too many docs popup */}
      {tooManyDocs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl space-y-4">
            <p className="text-sm font-semibold text-destructive">Limite dépassée</p>
            <p className="text-sm text-muted-foreground">Veuillez charger <strong>10 documents au maximum</strong> à la fois.</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setTooManyDocs(false)}>Compris</Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Import documents</h3>
        <span className="text-xs text-muted-foreground">— extraction automatique par IA</span>
        {step === 'review' && uploads.length > 0 && (
          <Badge variant="secondary" className="ml-auto">{currentIndex + 1}/{uploads.length}</Badge>
        )}
      </div>

      {step === 'upload' && (
        <>
          {uploads.length > 0 ? (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-800"><strong>{uploads.length} document{uploads.length > 1 ? 's' : ''}</strong> prêt{uploads.length > 1 ? 's' : ''} à analyser en parallèle</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {uploads.map((u, i) => (
                    <div key={i} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-white border border-blue-200">
                      <span>{u.file.name.length > 16 ? u.file.name.slice(0, 14) + '…' : u.file.name}</span>
                      <button onClick={() => setUploads(p => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive ml-1">×</button>
                    </div>
                  ))}
                </div>
              </div>

              {uploads.length < MAX_DOCS && (
                <div
                  className="border-2 border-dashed border-border rounded-xl p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={handleDrop}>
                  <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.csv" onChange={handleFile} multiple className="hidden" />
                  <p className="text-xs text-muted-foreground">Déposer ou cliquer pour ajouter d'autres documents ({uploads.length}/{MAX_DOCS})</p>
                </div>
              )}

              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Type de document pour tous *</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {DOC_TYPES.map(dt => (
                    <button key={dt.value}
                      onClick={() => setUploads(p => p.map(u => ({ ...u, docType: dt.value })))}
                      className={`p-2.5 rounded-lg border text-left transition-all text-xs ${uploads[0]?.docType === dt.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                      <p className="font-semibold">{dt.label}</p>
                      <p className="text-muted-foreground mt-0.5 text-[10px]">{dt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-between gap-2">
                <Button variant="outline" size="sm" onClick={() => setUploads([])}>Recommencer</Button>
                <Button size="sm" onClick={analyzeAll}>
                  <Loader2 className="w-3.5 h-3.5 mr-1 hidden" />
                  <CheckCircle className="w-3.5 h-3.5 mr-1" />
                  Analyser {uploads.length > 1 ? `les ${uploads.length} documents` : 'le document'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div
                className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={handleDrop}>
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.csv" onChange={handleFile} multiple className="hidden" />
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Déposer ou cliquer pour importer</p>
                  <p className="text-xs text-muted-foreground">PDF, image — jusqu'à 10 documents</p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={onClose}>Fermer</Button>
              </div>
            </>
          )}
        </>
      )}

      {step === 'analyzing' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
          <p className="text-sm font-medium">Analyse en cours…</p>
          <p className="text-xs text-muted-foreground">{analyzeProgress.done} / {analyzeProgress.total} document{analyzeProgress.total > 1 ? 's' : ''} traité{analyzeProgress.total > 1 ? 's' : ''}</p>
          <div className="w-full max-w-xs bg-muted rounded-full h-2">
            <div className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: analyzeProgress.total ? `${(analyzeProgress.done / analyzeProgress.total) * 100}%` : '0%' }} />
          </div>
        </div>
      )}

      {step === 'review' && currentUpload && !currentUpload.extracted && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm font-semibold text-destructive">Extraction échouée</p>
          <p className="text-xs text-muted-foreground">{currentUpload.error || 'Impossible d\'extraire les données de ce document.'}</p>
          <div className="flex gap-2">
            {currentIndex < uploads.length - 1 && (
              <Button size="sm" onClick={() => setCurrentIndex(i => i + 1)}>Document suivant →</Button>
            )}
            {currentIndex === uploads.length - 1 && (
              <Button size="sm" onClick={() => setStep('done')}>Terminer</Button>
            )}
          </div>
        </div>
      )}

      {step === 'review' && currentUpload?.extracted && (
        <>
          <div className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <Edit3 className="w-3.5 h-3.5 shrink-0" />
            Vérifiez et corrigez les informations extraites avant validation
          </div>

          {/* Lease action choice */}
          {currentUpload.docType === 'lease' && !currentUpload.leaseAction && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => updateCurrentUpload({ leaseAction: 'update_existing' })}
                  className="p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left">
                  <RefreshCw className="w-6 h-6 text-primary mb-2" />
                  <p className="font-semibold text-sm">Mettre à jour un bien existant</p>
                  <p className="text-xs text-muted-foreground mt-1">Associe ce locataire à un lot déjà enregistré</p>
                </button>
                <button onClick={() => updateCurrentUpload({ leaseAction: 'create_new_property' })}
                  className="p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left">
                  <Plus className="w-6 h-6 text-primary mb-2" />
                  <p className="font-semibold text-sm">Créer un nouveau bien</p>
                  <p className="text-xs text-muted-foreground mt-1">Ajoute un nouveau bien avec ce locataire</p>
                </button>
              </div>
            </>
          )}

          {currentUpload.docType === 'lease' && currentUpload.leaseAction && (
            <button onClick={() => updateCurrentUpload({ leaseAction: null, propertyId: '', lotId: '', newPropertyName: '' })}
              className="text-xs text-primary hover:underline">← Changer le choix</button>
          )}

          {/* New property name (when creating a brand new bien from a lease) */}
          {currentUpload.docType === 'lease' && currentUpload.leaseAction === 'create_new_property' && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Nom du bien *</Label>
              <Input
                className="h-8 text-sm"
                value={currentUpload.newPropertyName ?? ''}
                onChange={e => updateCurrentUpload({ newPropertyName: e.target.value })}
                placeholder="Ex: Appartement Rue de la Paix"
              />
            </div>
          )}

          {/* Deed action choice */}
          {currentUpload.docType === 'deed' && !currentUpload.deedAction && (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => updateCurrentUpload({ deedAction: 'create' })}
                className="p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left">
                <Plus className="w-6 h-6 text-primary mb-2" />
                <p className="font-semibold text-sm">Créer un nouveau bien</p>
                <p className="text-xs text-muted-foreground mt-1">Enregistre un nouveau bien dans le portefeuille</p>
              </button>
              <button onClick={() => updateCurrentUpload({ deedAction: 'update' })}
                className="p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left">
                <RefreshCw className="w-6 h-6 text-primary mb-2" />
                <p className="font-semibold text-sm">Mettre à jour un bien existant</p>
                <p className="text-xs text-muted-foreground mt-1">Complète/écrase les données d'un bien existant</p>
              </button>
            </div>
          )}

          {currentUpload.docType === 'deed' && currentUpload.deedAction && (
            <button onClick={() => updateCurrentUpload({ deedAction: null, propertyId: '' })}
              className="text-xs text-primary hover:underline">← Changer le choix</button>
          )}

          {/* SCI beneficiaries management */}
          {currentUpload.docType === 'sci' && currentUpload.extracted?.beneficiaries && (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-blue-900">Bénéficiaires/Associés extraits</p>
                <p className="text-xs text-blue-800 mt-1">{currentUpload.extracted.beneficiaries.length} personne(s) sera/seront créée(s)</p>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {currentUpload.extracted.beneficiaries.map((b, i) => (
                  <div key={i} className="p-3 bg-muted/50 rounded-lg border border-border text-xs space-y-1">
                    <p className="font-medium">{b.name}</p>
                    {b.email && <p>Email: {b.email}</p>}
                    {b.phone && <p>Tél: {b.phone}</p>}
                    {b.shares_number && <p>Nombre de parts: {b.shares_number}</p>}
                    {b.share_percent && <p>Part: {b.share_percent}%</p>}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Property selector for invoice */}
          {currentUpload.docType === 'invoice' && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Bien concerné *</Label>
                <Select value={currentUpload.propertyId} onValueChange={v => updateCurrentUpload({ propertyId: v, lotId: autoSelectLotIfSingle(v) })}>
                  <SelectTrigger><SelectValue placeholder="Choisir un bien..." /></SelectTrigger>
                  <SelectContent>{properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}

          {currentUpload.leaseAction === 'update_existing' && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Bien *</Label>
                <Select value={currentUpload.propertyId} onValueChange={v => updateCurrentUpload({ propertyId: v, lotId: autoSelectLotIfSingle(v) })}>
                  <SelectTrigger><SelectValue placeholder="Choisir un bien..." /></SelectTrigger>
                  <SelectContent>{properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {currentUpload.propertyId && propLots.length > 1 && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Lot à mettre à jour *</Label>
                  <Select value={currentUpload.lotId} onValueChange={v => updateCurrentUpload({ lotId: v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir un lot..." /></SelectTrigger>
                    <SelectContent>
                      {propLots.map(l => <SelectItem key={l.id} value={l.id}>{l.designation} {l.tenant_name ? `(${l.tenant_name})` : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {currentUpload.deedAction === 'update' && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Bien à mettre à jour *</Label>
              <Select value={currentUpload.propertyId} onValueChange={v => updateCurrentUpload({ propertyId: v })}>
                <SelectTrigger><SelectValue placeholder="Choisir un bien..." /></SelectTrigger>
                <SelectContent>{properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          {currentUpload.docType === 'loan' && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Bien à mettre à jour *</Label>
              <Select value={currentUpload.propertyId} onValueChange={v => updateCurrentUpload({ propertyId: v })}>
                <SelectTrigger><SelectValue placeholder="Choisir un bien..." /></SelectTrigger>
                <SelectContent>{properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          {currentUpload.docType === 'dpe' && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Bien concerné *</Label>
                <Select value={currentUpload.propertyId} onValueChange={v => updateCurrentUpload({ propertyId: v, lotId: autoSelectLotIfSingle(v) })}>
                  <SelectTrigger><SelectValue placeholder="Choisir un bien..." /></SelectTrigger>
                  <SelectContent>{properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {currentUpload.propertyId && propLots.length > 1 && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Lot concerné *</Label>
                  <Select value={currentUpload.lotId} onValueChange={v => updateCurrentUpload({ lotId: v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir un lot..." /></SelectTrigger>
                    <SelectContent>{propLots.map(l => <SelectItem key={l.id} value={l.id}>{l.designation}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {currentUpload.docType === 'invoice' && currentUpload.propertyId && propLots.length > 1 && (
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Lot (optionnel)</Label>
              <Select value={currentUpload.lotId} onValueChange={v => updateCurrentUpload({ lotId: v })}>
                <SelectTrigger><SelectValue placeholder="Choisir un lot..." /></SelectTrigger>
                <SelectContent>
                  {propLots.map(l => <SelectItem key={l.id} value={l.id}>{l.designation} {l.tenant_name ? `(${l.tenant_name})` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {(FIELD_LABELS[currentUpload.docType] || [])
              .filter(([key]) => !(key === 'name' && currentUpload.docType === 'deed' && currentUpload.deedAction !== 'create'))
              .map(([key, label, type]) => {
              // Désignation non modifiable si le lot est déjà existant (update)
              const isDesignationLocked = key === 'designation' && currentUpload.lotId && (currentUpload.leaseAction === 'update_existing' || currentUpload.docType === 'dpe');
              return (
                <FieldRow
                  key={key}
                  label={label}
                  value={isDesignationLocked ? (lots.find(l => l.id === currentUpload.lotId)?.designation ?? currentUpload.extracted[key]) : currentUpload.extracted[key]}
                  onChange={v => setField(key, type === 'number' ? (parseFloat(v) || v) : v)}
                  type={type || 'text'}
                  readOnly={!!isDesignationLocked}
                />
              );
            })}
          </div>

          <div className="flex justify-between items-center pt-2 gap-2">
            {currentIndex > 0
              ? <Button variant="outline" size="sm" onClick={() => setCurrentIndex(i => i - 1)}>← Précédent</Button>
              : <div />
            }
            <div className="flex gap-2">
              {currentIndex < uploads.length - 1 && (
                <Button variant="outline" size="sm" onClick={() => setCurrentIndex(i => i + 1)}>Passer →</Button>
              )}
              <Button size="sm" onClick={() => {
                const error = getSubmitError();
                if (error) { toast.error(error); return; }
                applyMutation.mutate();
              }} disabled={applyMutation.isPending}>
                <CheckCircle className="w-3.5 h-3.5 mr-1" />
                {currentIndex < uploads.length - 1 ? 'Valider & suivant' : 'Valider & terminer'}
              </Button>
            </div>
          </div>
        </>
      )}

      {step === 'done' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircle className="w-10 h-10 text-emerald-500" />
          <p className="text-sm font-medium">Tous les documents ont été importés avec succès</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setUploads([]); setCurrentIndex(0); setStep('upload'); }}>Importer d'autres documents</Button>
            <Button size="sm" onClick={onClose}>Fermer</Button>
          </div>
        </div>
      )}
    </div>
  );
}