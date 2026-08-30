import React, { useState, useMemo, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, X, CheckCircle2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/formatters';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { parseCsv, parseFrenchNumber } from '@/lib/import/csvUtils';

const MONTH_MAP = {
  'jan': 1, 'fév': 2, 'fev': 2, 'mar': 3, 'avr': 4, 'avril': 4, 'mai': 5, 'jun': 6, 'juin': 6,
  'jui': 7, 'juil': 7, 'jui.': 7, 'juil.': 7, 'aoû': 8, 'aou': 8, 'août': 8, 'aout': 8,
  'sep': 9, 'sept': 9, 'oct': 10, 'nov': 11, 'déc': 12, 'dec': 12, 'dec.': 12, 'déc.': 12
};

const EXPENSE_CATEGORIES = {
  'Échéance prêt': 'Échéance prêt',
  'Assurance habitation': 'Assurance habitation',
  'EDF': 'Électricité',
  'Électricité': 'Électricité',
  'Frais SCI': 'Frais SCI',
  'Copro': 'Copropriété',
  'Copropriété': 'Copropriété',
  'Travaux': 'Travaux',
  'Autre': 'Autres charges',
  'Virement interne': 'Virement interne',
};

const INCOME_CATEGORIES = {
  'Local Commercial': 'Loyer',
  'Logement': 'Loyer',
  'Virements': 'Loyer',
  'CAF': 'CAF',
};

function parseMonthYear(str) {
  if (!str) return null;
  const match = str.toLowerCase().match(/([a-zéôûî]+)[-\s\.]?(\d{2,4})/);
  if (!match) return null;
  const monthStr = match[1].replace(/[.\s]/g, '');
  const yearStr = match[2];
  const month = MONTH_MAP[monthStr];
  if (!month) return null;
  const year = yearStr.length === 2 ? 2000 + parseInt(yearStr) : parseInt(yearStr);
  return { month, year };
}

export default function FinancialCSVImporter({ property, onClose }) {
  const [file, setFile] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [lotAssignments, setLotAssignments] = useState({});
  const [isImporting, setIsImporting] = React.useState(false);
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();

  const { data: lots = [] } = useQuery({
    queryKey: ['lots', property?.id],
    queryFn: () => base44.entities.Lot.filter(withOwner({ property_id: property?.id })),
    enabled: !!property?.id,
  });

  const createManyMutation = useMutation({
    mutationFn: async (transactions) => {
      return await base44.entities.Transaction.bulkCreate(transactions);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions', property?.id] });
    },
  });

  const detectedExpenses = useMemo(() => {
    if (!parsedData) return [];
    const expenseKeys = new Set();
    parsedData.forEach(({ entries }) => {
      entries.filter(e => e.type === 'expense').forEach(e => expenseKeys.add(e.sourceKey));
    });
    return Array.from(expenseKeys);
  }, [parsedData]);

  const detectedIncome = useMemo(() => {
    if (!parsedData) return [];
    const incomeKeys = new Set();
    parsedData.forEach(({ entries }) => {
      entries.filter(e => e.type === 'income').forEach(e => incomeKeys.add(e.sourceKey));
    });
    return Array.from(incomeKeys);
  }, [parsedData]);

  if (!property?.id) {
    return null;
  }

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    const text = await uploadedFile.text();

    // Parser canonique RFC 4180 (BOM, guillemets, séparateurs embarqués, lignes vides).
    const { headers, rawRows, meta } = parseCsv(text);

    if (rawRows.length < 1) {
      const detail = meta.rejected > 0 ? ` (${meta.rejected} ligne(s) rejetée(s))` : '';
      toast.error('Fichier CSV vide ou invalide' + detail);
      return;
    }

    const monthIdx = headers.findIndex(h => /^mois$/i.test(h) || /mois|période|periode/.test((h || '').toLowerCase()));

    const parsedRows = [];
    rawRows.forEach((values) => {
      const monthStr = monthIdx >= 0 ? (values[monthIdx] || '') : '';
      const monthYear = parseMonthYear(monthStr) || { month: new Date().getMonth() + 1, year: new Date().getFullYear() };

      const entries = [];
      headers.forEach((key, idx) => {
        if (idx === monthIdx || !key) return;
        const value = values[idx];
        if (!value || value === '' || value === '-') return;

        const np = parseFrenchNumber(value);
        if (!np.ok) return; // montant invalide : entrée écartée (pas de 0 silencieux)
        const numValue = np.value;
        if (numValue === 0) return;

        let category = null;
        let type = null;
        if (INCOME_CATEGORIES[key]) {
          category = INCOME_CATEGORIES[key];
          type = 'income';
        } else if (EXPENSE_CATEGORIES[key]) {
          category = EXPENSE_CATEGORIES[key];
          type = 'expense';
        } else {
          category = key;
          type = numValue >= 0 ? 'income' : 'expense';
        }
        entries.push({ month: monthYear.month, year: monthYear.year, category, type, amount: Math.abs(numValue), sourceKey: key });
      });

      if (entries.length > 0) parsedRows.push({ monthYear, entries });
    });

    if (meta.rejected > 0) {
      toast.warning(`${meta.rejected} ligne(s) CSV rejetée(s) (format invalide)`);
    }

    setParsedData(parsedRows);
    setLotAssignments({});
  };

  const handleImport = async () => {
    if (!parsedData || parsedData.length === 0) return;

    setIsImporting(true);
    const transactions = [];

    parsedData.forEach(({ monthYear, entries }) => {
      entries.forEach(entry => {
        let lotId = null;
        
        if (['Local Commercial', 'Logement', 'Virements'].includes(entry.sourceKey)) {
          lotId = lotAssignments[entry.sourceKey] || null;
        }

        transactions.push({
          property_id: property.id,
          lot_id: lotId,
          year: monthYear.year,
          month: monthYear.month,
          category: entry.category,
          amount: entry.type === 'expense' ? -entry.amount : entry.amount,
          type: entry.type,
          note: `Import CSV financier - ${entry.sourceKey}`,
        });
      });
    });

    try {
      await createManyMutation.mutateAsync(transactions);
      toast.success(`${transactions.length} transactions importées avec succès`);
      onClose();
    } catch (error) {
      toast.error('Erreur lors de l\'import: ' + error.message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Card className="mb-6 border-emerald-200 bg-emerald-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <CardTitle className="text-base">Import tableau financier CSV</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!parsedData ? (
          <div className="border-2 border-dashed border-emerald-300 rounded-lg p-8 text-center">
            <Upload className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-2">Sélectionnez votre fichier CSV financier</p>
            <Input type="file" accept=".csv" onChange={handleFileUpload} className="max-w-xs mx-auto" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 text-xs">
              <Badge className="bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {detectedIncome.length} revenus détectés
              </Badge>
              <Badge className="bg-red-100 text-red-700">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {detectedExpenses.length} dépenses détectées
              </Badge>
            </div>

            {detectedIncome.length > 0 && lots.length > 0 && (
              <Card className="border-amber-200 bg-amber-50/30">
                <CardContent className="p-4 space-y-3">
                  <p className="text-xs font-semibold text-amber-800 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Affectation des revenus aux lots
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {detectedIncome.map(incomeKey => (
                      <div key={incomeKey} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-32 truncate" title={incomeKey}>{incomeKey}:</span>
                        <Select
                          value={lotAssignments[incomeKey] || ''}
                          onValueChange={(val) => setLotAssignments(prev => ({ ...prev, [incomeKey]: val }))}
                        >
                          <SelectTrigger className="h-8 text-xs flex-1">
                            <SelectValue placeholder="Sélectionner un lot..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={null}>Property (global)</SelectItem>
                            {lots.map(lot => (
                              <SelectItem key={lot.id} value={lot.id}>
                                {lot.designation} {lot.tenant_name ? `(${lot.tenant_name})` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">
                {parsedData.reduce((s, r) => s + r.entries.length, 0)} transactions à importer
              </p>
              <div className="max-h-96 overflow-auto border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Mois</TableHead>
                      <TableHead className="w-32">Lot</TableHead>
                      <TableHead className="w-24">Type</TableHead>
                      <TableHead>Catégorie</TableHead>
                      <TableHead className="text-right w-28">Montant</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.map(({ monthYear, entries }, idx) => (
                      <React.Fragment key={idx}>
                        {entries.map((entry, entryIdx) => {
                          let lotName = 'Property';
                          let lotBadge = null;
                          if (['Local Commercial', 'Logement', 'Virements'].includes(entry.sourceKey)) {
                            const assignedLotId = lotAssignments[entry.sourceKey];
                            const assignedLot = lots.find(l => l.id === assignedLotId);
                            if (assignedLot) {
                              lotName = assignedLot.designation;
                              lotBadge = <Badge variant="outline" className="text-[9px] h-5">{assignedLot.typology || 'Lot'}</Badge>;
                            }
                          }
                          return (
                            <TableRow key={`${idx}-${entryIdx}`} className="text-xs hover:bg-muted/30">
                              {entryIdx === 0 && (
                                <TableCell rowSpan={entries.length} className="font-medium align-top py-2">
                                  <div className="text-sm">{monthYear.month}/{monthYear.year}</div>
                                </TableCell>
                              )}
                              <TableCell className="text-xs text-muted-foreground py-2">
                                <div className="flex items-center gap-1">
                                  <span>{lotName}</span>
                                  {lotBadge}
                                </div>
                              </TableCell>
                              <TableCell className="py-2">
                                <Badge variant={entry.type === 'income' ? 'secondary' : 'destructive'} className="text-[10px]">
                                  {entry.type === 'income' ? 'Entrée' : 'Sortie'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground py-2">{entry.category}</TableCell>
                              <TableCell className="text-right font-medium number-fr py-2">
                                <span className={entry.type === 'income' ? 'text-emerald-600' : 'text-red-600'}>
                                  {formatCurrency(entry.amount, entry.type === 'expense')}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
              <Button 
                size="sm" 
                onClick={handleImport}
                disabled={isImporting}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {isImporting ? 'Import...' : `Importer ${parsedData.reduce((s, r) => s + r.entries.length, 0)} transactions`}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}