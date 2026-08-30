import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { can, roleLabel } from '@/lib/patrimony';
import InviteDialog from '@/components/team/InviteDialog';
import MemberRow from '@/components/team/MemberRow';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, UserPlus, Users, Shield, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import EmptyState from '@/components/EmptyState';
import { IlloEquipe } from '@/components/illustrations/EmptyIllustrations';

export default function Team() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const role = user?.patrimony_role;
  const canManage = can(role, 'manage_team');

  const { data, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: async () => {
      const res = await base44.functions.invoke('manageAccess', { op: 'list' });
      return res.data || res;
    },
  });

  const members = data?.members || [];

  const inviteMut = useMutation({
    mutationFn: async (payload) => base44.functions.invoke('manageAccess', { op: 'invite', ...payload }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team'] }); toast.success('Invitation envoyée.'); },
    onError: (e) => toast.error('Échec de l\'invitation : ' + (e?.message || e)),
  });

  const roleMut = useMutation({
    mutationFn: async ({ email, role }) => base44.functions.invoke('manageAccess', { op: 'updateRole', email, role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team'] }); toast.success('Rôle mis à jour.'); },
    onError: (e) => toast.error('Échec : ' + (e?.message || e)),
  });

  const revokeMut = useMutation({
    mutationFn: async (email) => base44.functions.invoke('manageAccess', { op: 'revoke', email }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team'] }); toast.success('Membre révoqué.'); },
    onError: (e) => toast.error('Échec : ' + (e?.message || e)),
  });

  const reactivateMut = useMutation({
    mutationFn: async (email) => base44.functions.invoke('manageAccess', { op: 'reactivate', email }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team'] }); toast.success('Membre réactivé.'); },
    onError: (e) => toast.error('Échec : ' + (e?.message || e)),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Users className="w-6 h-6 text-primary" /> Équipe & rôles</h1>
          <p className="text-muted-foreground">Gérez les utilisateurs de ce patrimoine et leurs droits. Le contrôle d'accès est appliqué côté serveur.</p>
        </div>
        {canManage && (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="w-4 h-4" /> Inviter un membre
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="w-4 h-4" /> Votre rôle</CardTitle>
          <CardDescription>
            Vous êtes <strong className="text-foreground">{roleLabel(role)}</strong> sur ce patrimoine.
            {role === 'OWNER' && ' Vous êtes le propriétaire : tous les droits, y compris la gestion des membres.'}
            {role === 'READ_ONLY' && ' Lecture seule : vous ne pouvez pas modifier les données.'}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Membres du patrimoine</CardTitle>
          <CardDescription>{members.length} membre(s). Les rôles contrôlent l'accès aux modules et actions sensibles.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="hidden sm:flex items-center gap-3 py-2 border-b text-xs font-semibold text-muted-foreground uppercase">
                <div className="flex-1">Membre</div>
                <div className="w-28">Statut</div>
                <div className="w-36">Rôle</div>
                <div className="w-24 text-right">Actions</div>
              </div>
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isCurrentUser={m.user_email === user?.email}
                  canManage={canManage}
                  onRoleChange={(member, newRole) => roleMut.mutate({ email: member.user_email, role: newRole })}
                  onRevoke={(member) => revokeMut.mutate(member.user_email)}
                  onReactivate={(member) => reactivateMut.mutate(member.user_email)}
                />
              ))}
              {members.length === 0 && (
                <EmptyState
                  illustration={<IlloEquipe />}
                  title="Vous êtes seul(e) sur ce patrimoine"
                  subtitle="Invitez votre comptable, un gestionnaire ou un associé pour collaborer en toute sécurité."
                  primary={canManage ? <Button onClick={() => setInviteOpen(true)} className="gap-2"><UserPlus className="w-4 h-4" />Inviter un membre</Button> : null}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {can(role, 'view_audit_log') && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ScrollText className="w-4 h-4" /> Journal d'audit</CardTitle>
            <CardDescription>Consultez le journal complet des opérations sensibles.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline"><Link to="/audit">Ouvrir le journal d'audit</Link></Button>
          </CardContent>
        </Card>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvite={(p) => inviteMut.mutateAsync(p)} />
    </div>
  );
}