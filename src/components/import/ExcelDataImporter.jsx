import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { useOwnerFilter } from '@/lib/tenantFilter';

export default function ExcelDataImporter() {
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [stats, setStats] = useState(null);
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();

  const importMutation = useMutation({
    mutationFn: async (fileData) => {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      
      // Read Base_Immeubles sheet
      const sheet = workbook.Sheets['Base_Immeubles'];
      const jsonData = XLSX.utils.sheet_to_json(sheet);
      
      // Map property names to IDs
      const properties = await base44.entities.Property.filter(withOwner());
      const propertyMap = {};
      properties.forEach(p => {
        propertyMap[p.name] = p.id;
      });

      // Transform data
      const transactions = [];
      const now = new Date();
      
      for (const row of jsonData) {
        const propertyId = propertyMap[row.Bien];
        if (!propertyId) {
          console.warn('Property not found:', row.Bien);
          continue;
        }

        const date = new Date(row.Date);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        
        const isIncome = row.Type_flux === 'Entrée';
        const amount = isIncome ? Math.abs(row.Montant) : -Math.abs(row.Montant);
        
        // Map category
        let category = row.Categorie || 'Divers';
        
        transactions.push({
          property_id: propertyId,
          lot_id: null,
          year,
          month,
          category,
          amount,
          type: isIncome ? 'income' : 'expense',
          note: row.Lot ? `Lot: ${row.Lot}` : null,
          bank_import_id: null
        });
      }

      // Bulk create in batches of 100
      const batchSize = 100;
      for (let i = 0; i < transactions.length; i += batchSize) {
        const batch = transactions.slice(i, i + batchSize);
        await base44.entities.Transaction.bulkCreate(batch);
      }

      return {
        total: transactions.length,
        properties: Object.keys(propertyMap).length
      };
    },
    onSuccess: (result) => {
      setStats(result);
      toast.success(`${result.total} transactions importées avec succès`);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (error) => {
      toast.error(`Erreur: ${error.message}`);
    }
  });

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleImport = () => {
    if (!file) return;
    setParsing(true);
    importMutation.mutate(file);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5" />
          Import des données financières Excel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
            id="excel-upload"
          />
          <label htmlFor="excel-upload">
            <Button asChild variant="outline" className="cursor-pointer">
              <span>Choisir un fichier Excel</span>
            </Button>
          </label>
          {file && (
            <p className="mt-2 text-sm text-muted-foreground">
              Fichier sélectionné: {file.name}
            </p>
          )}
        </div>

        {parsing && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Import en cours...</span>
          </div>
        )}

        {stats && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle className="w-4 h-4" />
            <span>{stats.total} transactions importées pour {stats.properties} propriétés</span>
          </div>
        )}

        {importMutation.isError && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="w-4 h-4" />
            <span>Erreur lors de l'import</span>
          </div>
        )}

        <Button 
          onClick={handleImport} 
          disabled={!file || parsing}
          className="w-full"
        >
          {parsing ? 'Import en cours...' : 'Importer les données'}
        </Button>
      </CardContent>
    </Card>
  );
}