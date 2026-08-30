import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, User, Settings, LogOut, Search } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

export default function MobileTopBar({ onOpenCommand }) {
  const navigate = useNavigate();

  return (
    <header className="md:hidden sticky top-0 z-40 bg-card border-b border-border flex items-center justify-between px-4 h-14">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
          <Building2 className="w-4 h-4 text-primary-foreground" />
        </div>
        <span className="font-bold text-sm tracking-tight">Patrimo</span>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={onOpenCommand} className="p-2 rounded-lg hover:bg-accent transition-colors" aria-label="Recherche">
          <Search className="w-5 h-5" />
        </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-2 rounded-lg hover:bg-accent transition-colors" aria-label="Menu utilisateur">
            <User className="w-5 h-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => navigate('/reglages')}>
            <Settings className="w-4 h-4 mr-2" /> Réglages
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => base44.auth.logout()}>
            <LogOut className="w-4 h-4 mr-2" /> Déconnexion
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </header>
  );
}