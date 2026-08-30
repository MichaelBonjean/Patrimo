import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { roleLabel, ROLE_OPTIONS } from '@/lib/patrimony';
import { ShieldCheck, Clock, Ban, RotateCcw } from 'lucide-react';

const statusBadge = (status) => {
  const map = {
    active: { cls: 'bg-emerald-100 text-emerald-700', icon: ShieldCheck, label: 'Actif' },
    invited: { cls: 'bg-amber-100 text-amber-700', icon: Clock, label: 'Invité' },
    revoked: { cls: 'bg-red-100 text-red-700', icon: Ban, label: 'Révoqué' },
  };
  const m = map[status] || map.active;
  const Icon = m.icon;
  return <Badge variant="secondary" className={`gap-1 ${m.cls}`}><Icon className="w-3 h-3" /> {m.label}</Badge>;
};

export default function MemberRow({ member, isCurrentUser, canManage, onRoleChange, onRevoke, onReactivate }) {
  const isOwner = member.patrimony_role === 'OWNER';
  return (
    <div className="flex items-center gap-3 py-3 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{member.full_name || member.user_email}</span>
          {isCurrentUser && <Badge variant="outline" className="text-xs">Vous</Badge>}
        </div>
        <div className="text-sm text-muted-foreground truncate">{member.user_email}</div>
      </div>
      <div className="hidden sm:block w-28">
        {statusBadge(member.status)}
      </div>
      <div className="w-36">
        {isOwner ? (
          <Badge className="bg-primary text-primary-foreground">{roleLabel(member.patrimony_role)}</Badge>
        ) : canManage ? (
          <Select value={member.patrimony_role} onValueChange={(v) => onRoleChange(member, v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm">{roleLabel(member.patrimony_role)}</span>
        )}
      </div>
      <div className="w-24 text-right">
        {canManage && !isOwner && member.status !== 'revoked' && (
          <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => onRevoke(member)}>
            <Ban className="w-4 h-4" /> Révoquer
          </Button>
        )}
        {canManage && !isOwner && member.status === 'revoked' && (
          <Button size="sm" variant="ghost" onClick={() => onReactivate(member)}>
            <RotateCcw className="w-4 h-4" /> Réactiver
          </Button>
        )}
      </div>
    </div>
  );
}