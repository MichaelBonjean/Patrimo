import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Wallet, Landmark, Settings, CreditCard,
  ChevronLeft, ChevronRight, LogOut, Search, ChevronUp, UploadCloud, ListTodo,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { colorForDomain, ROUTE_DOMAIN } from '@/lib/iconColors';
import AttentionCountBadge from '@/components/layout/AttentionCountBadge';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { roleLabel } from '@/lib/patrimony';
import { toast } from 'sonner';

const MAIN_ITEMS = [
  { path: '/', icon: LayoutDashboard, label: 'Accueil' },
  { path: '/a-faire', icon: ListTodo, label: 'À faire', attention: true },
  { path: '/biens', icon: Building2, label: 'Mes biens' },
  { path: '/loyers', icon: Wallet, label: 'Loyers' },
  { path: '/import', icon: UploadCloud, label: 'Importer des documents', accent: true },
  { path: '/banque', icon: Landmark, label: 'Banque' },
];
const PREFS_ITEMS = [
  { path: '/reglages', icon: Settings, label: 'Réglages' },
  { path: '/facturation', icon: CreditCard, label: 'Facturation' },
];
const ALL_ITEMS = [...MAIN_ITEMS, ...PREFS_ITEMS];

const OVERLINE = 'px-4 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60';

function NavGroup({ items, label, collapsed, location, visible }) {
  return (
    <div className="flex flex-col">
      {!collapsed && <p className={OVERLINE}>{label}</p>}
      {items.filter((i) => visible[i.path]).map((item) => {
        const isActive = item.path === '/'
          ? location.pathname === '/'
          : location.pathname === item.path || location.pathname.startsWith(item.path + '/');
        return (
          <Link
          key={item.path}
          to={item.path}
          className={cn(
            "flex items-center gap-3 h-[52px] px-4 rounded-r-xl rounded-l-none border-l-4 text-[15px] font-semibold transition-all",
            isActive
              ? "border-primary bg-primary/10 text-primary"
              : "border-transparent text-sidebar-foreground/70 hover:bg-muted hover:text-sidebar-foreground",
            item.accent && !isActive && 'bg-primary/[0.04]'
          )}
          >
          <item.icon className={cn('w-5 h-5 shrink-0', isActive ? 'text-primary' : item.accent ? 'text-primary' : colorForDomain(ROUTE_DOMAIN[item.path] || 'biens'))} />
          {!collapsed && (
            <span className="flex-1 truncate flex items-center gap-2">
              {item.label}
              {item.attention && <AttentionCountBadge active={isActive} />}
            </span>
          )}
          </Link>
        );
      })}
    </div>
  );
}

export default function Sidebar({ collapsed, setCollapsed, onOpenCommand }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isReadOnly = user?.patrimony_role === 'READ_ONLY';
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const visible = Object.fromEntries(ALL_ITEMS.map((i) => [i.path, isReadOnly ? i.path === '/' : true]));
  const name = user?.full_name || user?.email || '—';
  const initials = name.trim().split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();

  return (
    <aside className={cn(
      "fixed left-0 top-0 h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col z-50 transition-all duration-300",
      collapsed ? "w-[72px]" : "w-64"
    )}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-sidebar-border">
        <svg className="w-9 h-9 shrink-0" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect width="48" height="48" rx="11" fill="#16305C" />
          <rect x="33" y="7" width="8" height="8" fill="#E8B23A" />
          <text x="23" y="33" textAnchor="middle" fontFamily="Inter,Segoe UI,Arial,sans-serif" fontWeight="700" fontSize="22" fill="#E8B23A">Pa</text>
        </svg>
        {!collapsed && (
          <span className="font-display font-semibold text-lg tracking-tight truncate text-foreground">Patrimo</span>
        )}
      </div>

      {/* Recherche globale */}
      <div className="px-3 pt-4">
        <button
          onClick={onOpenCommand}
          className="flex w-full items-center gap-3.5 rounded-xl px-4 h-[52px] text-[15px] font-medium text-sidebar-foreground/70 hover:bg-muted transition-all"
        >
          <Search className="w-5 h-5 shrink-0" />
          {!collapsed && <span className="flex-1 text-left truncate">Recherche</span>}
          {!collapsed && (
            <kbd className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-sidebar-accent text-sidebar-foreground/50">
              {isMac ? '⌘K' : 'Ctrl K'}
            </kbd>
          )}
        </button>
      </div>

      {/* Navigation — Gestion / Préférences */}
      <nav className="flex-1 py-4 px-3 flex flex-col gap-3 overflow-y-auto">
        <NavGroup items={MAIN_ITEMS} label="Gestion" collapsed={collapsed} location={location} visible={visible} />
        <div className="border-t border-sidebar-border/60 mx-1" />
        <NavGroup items={PREFS_ITEMS} label="Préférences" collapsed={collapsed} location={location} visible={visible} />
      </nav>

      {/* Footer : collapse + menu utilisateur */}
      <div className="px-3 pb-4 pt-3 border-t border-sidebar-border/60 flex flex-col gap-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3.5 h-11 px-4 rounded-xl text-[15px] font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-muted w-full transition-all"
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          {!collapsed && <span>Réduire</span>}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 w-full px-2 h-12 rounded-xl hover:bg-muted transition-all">
              <span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                {initials}
              </span>
              {!collapsed && (
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-semibold text-foreground leading-tight">{name}</p>
                  <p className="truncate text-[11px] text-muted-foreground leading-tight">
                    {roleLabel(user?.patrimony_role) || 'Propriétaire'}
                  </p>
                </div>
              )}
              {!collapsed && <ChevronUp className="w-4 h-4 text-muted-foreground/60 shrink-0" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" sideOffset={8} align="end" className="w-60">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              {user?.email || ''}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/reglages')}>
              Mon profil
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/facturation')}>
              Mon abonnement
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toast.info('Aide — contactez le support Base44')}>
              Aide
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => base44.auth.logout()}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="w-4 h-4 mr-2" /> Se déconnecter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}