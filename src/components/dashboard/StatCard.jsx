import React from 'react';
import { cn } from '@/lib/utils';
import { colorForDomain } from '@/lib/iconColors';

export default function StatCard({ label, value, subtitle, icon: Icon, trend, domain = 'biens', className }) {
  return (
    <div className={cn(
      "bg-card rounded-xl border border-border p-5 relative overflow-hidden group hover:shadow-md transition-shadow",
      className
    )}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold number-fr">{value}</p>
          {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {Icon && (
          <div className="p-2.5 rounded-lg bg-muted">
            <Icon className={cn('w-5 h-5', colorForDomain(domain))} />
          </div>
        )}
      </div>
      {trend && (
        <div className={cn(
          "mt-3 text-xs font-medium",
          trend > 0 ? "text-emerald-600" : "text-red-500"
        )}>
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </div>
  );
}