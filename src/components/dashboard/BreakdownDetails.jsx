import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency, formatPercent, calcTotalAcquisition, calcTotalMonthlyPayment } from '@/lib/formatters';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function BreakdownDetails({ isOpen, onClose, title, data }) {
  if (!data) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-muted/50 rounded-lg p-4 border border-border">
            <p className="text-sm text-muted-foreground mb-2">Total</p>
            <p className="text-2xl font-bold">{data.total}</p>
          </div>

          {/* Breakdown by property */}
          <div>
            <h3 className="text-sm font-semibold mb-3 pb-2 border-b border-border">Détail par bien</h3>
            <div className="space-y-2">
              {data.items?.map((item, idx) => (
                <div key={idx} className="p-3 bg-card rounded-lg border border-border">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium text-sm">{item.propertyName}</p>
                      {item.share < 1 && (
                        <p className="text-xs text-muted-foreground">Part: {formatPercent(item.share * 100)}</p>
                      )}
                    </div>
                    <p className="font-semibold text-sm">{item.value}</p>
                  </div>
                  {item.breakdown && (
                    <div className="text-xs text-muted-foreground space-y-0.5 ml-2">
                      {item.breakdown.map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Formula if provided */}
          {data.formula && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-blue-900 mb-2">Formule de calcul</p>
              <p className="text-xs text-blue-800 font-mono">{data.formula}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}