import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Building2, Wallet, Landmark } from 'lucide-react';
import { colorForDomain, ROUTE_DOMAIN } from '@/lib/iconColors';

const tabs = [
  { path: '/', label: 'Accueil', icon: LayoutDashboard },
  { path: '/biens', label: 'Biens', icon: Building2 },
  { path: '/loyers', label: 'Loyers', icon: Wallet },
  { path: '/banque', label: 'Banque', icon: Landmark },
];

export default function BottomTabBar() {
  const location = useLocation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map(({ path, label, icon: Icon }) => {
        const active = path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(path + '/');
        return (
          <Link
            key={path}
            to={path}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium select-none transition-colors min-h-[49px] ${
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className={`w-[22px] h-[22px] ${active ? 'stroke-[2.5px]' : ''} ${colorForDomain(ROUTE_DOMAIN[path] || 'biens')}`} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}