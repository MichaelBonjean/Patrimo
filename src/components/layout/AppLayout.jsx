import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import ErrorBoundary from '@/components/ErrorBoundary';
import Sidebar from './Sidebar';
import BottomTabBar from './BottomTabBar';
import AnimatedOutlet from './AnimatedRoutes';
import MobileTopBar from './MobileTopBar';
import CommandPalette from '@/components/CommandPalette';
import BillingBanner from '@/components/BillingBanner';
import QuickActionsFab from '@/components/QuickActionsFab';
import SupportFab from '@/components/support/SupportFab';
import CookieBanner from '@/components/legal/CookieBanner';
import LegalConsentGate from '@/components/legal/LegalConsentGate';
import LegalFooter from '@/components/legal/LegalFooter';
import { useFeatureUnlockChecker } from '@/lib/featureFlags';
import { useAuth } from '@/lib/AuthContext';

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved !== null) return saved === 'true';
    return window.innerWidth < 1280;
  });
  const [commandOpen, setCommandOpen] = useState(false);
  const { user } = useAuth();
  useEffect(() => { localStorage.setItem('sidebar-collapsed', String(collapsed)); }, [collapsed]);
  useFeatureUnlockChecker();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-background">
      {/* Sidebar: visible only on md+ */}
      <div className="hidden md:block">
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} onOpenCommand={() => setCommandOpen(true)} />
      </div>
      <main className={`${collapsed ? 'md:ml-[72px]' : 'md:ml-64'} min-h-screen transition-all duration-300 mobile-main-padding`}>
        <style>{`.mobile-main-padding { padding-bottom: calc(49px + env(safe-area-inset-bottom)); } @media (min-width: 768px) { .mobile-main-padding { padding-bottom: 0; } }`}</style>
        <BillingBanner />
        <MobileTopBar onOpenCommand={() => setCommandOpen(true)} />
        <AnimatedOutlet><Outlet /></AnimatedOutlet>
        <LegalFooter />
      </main>
      {/* Bottom tab bar: visible only on mobile */}
      <BottomTabBar />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <QuickActionsFab />
      <SupportFab />
      <CookieBanner />
      <LegalConsentGate user={user} />
    </div>
    </ErrorBoundary>
  );
}