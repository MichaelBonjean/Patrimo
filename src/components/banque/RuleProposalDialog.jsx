import React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { labelOf } from '@/lib/financeCategories';

/**
 * Dialogue de proposition d'apprentissage — apparaît après un rapprochement
 * manuel. L'utilisateur décide [Oui] / [Non] ; rien n'est créé silencieusement.
 *
 * Props :
 *   open      : boolean
 *   proposal  : { candidate, conflicts, suggestion, reason, owner_id, learned_from_transaction_id }
 *   onAccept(ruleData) : crée la BankRule
 *   onClose() : décline
 */
export default function RuleProposalDialog({ open, proposal, onAccept, onClose }) {
  if (!proposal || !proposal.candidate) return null;
  const { candidate, conflicts = [], reason } = proposal;
  const catLabel = candidate.assigned_category ? (labelOf(candidate.assigned_category) || candidate.assigned_category) : 'Loyer';

  const buildRuleData = () => ({
    owner_id: proposal.owner_id,
    keyword: candidate.keyword,
    conditions: candidate.conditions || { direction: 'any' },
    assigned_category: candidate.assigned_category || '',
    assigned_lease_id: candidate.assigned_lease_id || null,
    assigned_property_id: candidate.assigned_property_id || null,
    assigned_lot_id: candidate.assigned_lot_id || null,
    is_active: true,
    priority: candidate.priority ?? 10,
    source: 'learned_from_validation',
    learned_from_transaction_id: proposal.learned_from_transaction_id || null,
    match_count: 0,
    history: [{
      date: new Date().toISOString(),
      action: 'created',
      actor: proposal.owner_id,
      note: 'Apprise depuis une validation manuelle',
    }],
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Reconnaître automatiquement les prochains virements similaires ?
          </DialogTitle>
          <DialogDescription>
            {reason}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Si la description contient</span>
              <code className="text-xs bg-background px-2 py-0.5 rounded font-mono border border-border">"{candidate.keyword}"</code>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">→ alors affecter à</span>
              <Badge variant="secondary" className="text-xs">{catLabel}</Badge>
              {candidate.conditions?.direction && candidate.conditions.direction !== 'any' && (
                <Badge variant="outline" className="text-xs">
                  {candidate.conditions.direction === 'in' ? 'Entrée' : 'Sortie'}
                </Badge>
              )}
            </div>
          </div>

          {conflicts.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-950/30 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5" /> Conflit potentiel avec une règle existante
              </div>
              {conflicts.map((c, i) => (
                <div key={i} className="text-xs text-amber-700 dark:text-amber-300/90 pl-5">
                  {c.note}
                </div>
              ))}
              {conflicts.some((c) => c.kind === 'broader_existing') && (
                <div className="text-xs text-amber-700 dark:text-amber-300/90 pl-5">
                  La nouvelle règle aura une priorité supérieure pour primer.
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Non, cette fois-ci</Button>
          <Button onClick={() => onAccept(buildRuleData())}>
            Oui, créer la règle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}