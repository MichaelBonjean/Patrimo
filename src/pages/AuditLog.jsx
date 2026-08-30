import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { can } from '@/lib/patrimony';
import AuditRow from '@/components/team/AuditRow';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, ScrollText, ShieldAlert } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import { IlloAudit } from '@/components/illustrations/EmptyIllustrations';

export default function AuditLog() {
  const { user } = useAuth();
  const role = user?.patrimony_role;
  const allowed = can(role, 'view_audit_log');

  const { data, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: async () => {
      const res = await base44.functions.invoke('manageAccess', { op: 'auditLog', limit: 200 });
      return res.data || res;
    },
    enabled: allowed,
  });

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="w-10 h-10 text-muted-foreground mb-3" />
        <h2 className="text-lg font-semibold">Accès restreint</h2>
        <p className="text-muted-foreground">Votre rôle ne permet pas de consulter le journal d'audit.</p>
      </div>
    );
  }

  const entries = data?.entries || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ScrollText className="w-6 h-6 text-primary" /> Journal d'audit</h1>
        <p className="text-muted-foreground">Trace des opérations sensibles : qui a fait quoi, quand, sur quel objet.</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Opérations récentes</CardTitle>
          <CardDescription>{entries.length} entrée(s) — triées du plus récent au plus ancien.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : entries.length === 0 ? (
            <EmptyState
              illustration={<IlloAudit />}
              title="Aucune action journalisée"
              subtitle="Les opérations sensibles (import, rapprochement, création, suppression) apparaîtront ici automatiquement."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-xs font-semibold text-muted-foreground uppercase border-b">
                    <th className="py-2 px-3 text-left">Quand</th>
                    <th className="py-2 px-3 text-left">Qui</th>
                    <th className="py-2 px-3 text-left">Action</th>
                    <th className="py-2 px-3 text-left">Objet</th>
                    <th className="py-2 px-3 text-left">Détails</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => <AuditRow key={e.id} entry={e} />)}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}