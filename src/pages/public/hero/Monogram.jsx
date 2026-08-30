import React from 'react';

export function Monogram({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg className="w-8 h-8" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <rect width="48" height="48" rx="11" fill="#16305C" />
        <rect x="33" y="7" width="8" height="8" fill="#E8B23A" />
        <text x="23" y="33" textAnchor="middle" fontFamily="Inter,Segoe UI,Arial" fontWeight="700" fontSize="22" fill="#E8B23A">Pa</text>
      </svg>
      <span className="font-display font-semibold text-lg tracking-tight">Patrimo</span>
    </span>
  );
}