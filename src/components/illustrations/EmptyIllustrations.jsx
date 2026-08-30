import React from 'react';

const PRIMARY = 'hsl(var(--primary))';
const ACCENT = 'hsl(var(--accent))';
const MUTED = 'hsl(var(--muted-foreground))';

const base = (children, className) => (
  <svg width="120" height="104" viewBox="0 0 120 104" fill="none" className={className}
    strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
    {children}
  </svg>
);

/** Immeuble — biens */
export function IlloBiens({ className }) {
  return base(
    <>
      <path d="M40 86V40l20-12 20 12v46" stroke={PRIMARY} />
      <path d="M32 86h56" stroke={PRIMARY} />
      <rect x="52" y="50" width="16" height="16" rx="1.5" stroke={PRIMARY} />
      <path d="M52 44h16" stroke={PRIMARY} />
      <path d="M70 86v-12h10v12" stroke={PRIMARY} />
      <path d="M44 56h4M44 66h4M80 60h4M80 70h4" stroke={PRIMARY} opacity="0.6" />
      <path d="M60 28l-6-10 6-4 6 4-6 10z" stroke={ACCENT} />
    </>,
    className
  );
}

/** Enveloppe + euro — loyers */
export function IlloLoyers({ className }) {
  return base(
    <>
      <rect x="28" y="36" width="64" height="42" rx="4" stroke={PRIMARY} />
      <path d="M28 40l32 22 32-22" stroke={PRIMARY} />
      <circle cx="60" cy="74" r="10" stroke={ACCENT} />
      <path d="M57 74h6M57 74v-3h6v3M60 71v6" stroke={ACCENT} />
    </>,
    className
  );
}

/** Colonnes bancaires + flèche d'import — banque */
export function IlloBanque({ className }) {
  return base(
    <>
      <path d="M40 42L60 26l20 16" stroke={PRIMARY} />
      <path d="M44 42v34M60 42v34M76 42v34" stroke={PRIMARY} />
      <path d="M36 76h48M36 86h48" stroke={PRIMARY} />
      <path d="M92 36V22M86 28h12" stroke={ACCENT} />
    </>,
    className
  );
}

/** Document + coche — quittances */
export function IlloQuittances({ className }) {
  return base(
    <>
      <rect x="40" y="30" width="40" height="52" rx="3" stroke={PRIMARY} />
      <path d="M48 44h24M48 54h24M48 64h16" stroke={PRIMARY} opacity="0.6" />
      <path d="M66 70l4 4 8-9" stroke={ACCENT} />
    </>,
    className
  );
}

/** Cœur + pouce levé — impayés (positif) */
export function IlloImpayes({ className }) {
  return base(
    <>
      <path d="M60 84C44 72 34 60 34 48a12 12 0 012-7 12 12 0 0119-3 12 12 0 0119 3 12 12 0 012 7c0 12-10 24-26 36z" stroke={PRIMARY} />
      <path d="M44 48l5 5 9-10" stroke={ACCENT} />
    </>,
    className
  );
}

/** Dossier + feuilles — documents */
export function IlloDocuments({ className }) {
  return base(
    <>
      <path d="M34 40h16l4 5h30v38a4 4 0 01-4 4H34a4 4 0 01-4-4V44a4 4 0 014-4z" stroke={PRIMARY} />
      <rect x="44" y="50" width="34" height="34" rx="3" stroke={PRIMARY} opacity="0.7" />
      <path d="M52 64h18M52 72h12" stroke={PRIMARY} opacity="0.6" />
      <path d="M60 40V30h14" stroke={ACCENT} />
    </>,
    className
  );
}

/** Cloche + étincelle — alertes (rien à faire) */
export function IlloAlertes({ className }) {
  return base(
    <>
      <path d="M60 28a16 16 0 0116 16v14l6 8H38l6-8V44a16 16 0 0116-16z" stroke={PRIMARY} />
      <path d="M52 74h16a8 8 0 01-16 0z" stroke={PRIMARY} />
      <path d="M92 32l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" stroke={ACCENT} />
    </>,
    className
  );
}

/** Deux personnes — équipe */
export function IlloEquipe({ className }) {
  return base(
    <>
      <circle cx="46" cy="46" r="10" stroke={PRIMARY} />
      <path d="M28 86c0-12 8-20 18-20s18 8 18 20" stroke={PRIMARY} />
      <circle cx="78" cy="50" r="8" stroke={PRIMARY} />
      <path d="M64 86c0-9 6-15 14-15s14 6 14 15" stroke={PRIMARY} />
      <path d="M60 68l4-3 4 3" stroke={ACCENT} />
    </>,
    className
  );
}

/** Rouleau de journal — audit */
export function IlloAudit({ className }) {
  return base(
    <>
      <rect x="40" y="28" width="40" height="56" rx="4" stroke={PRIMARY} />
      <path d="M48 42h24M48 52h24M48 62h16" stroke={PRIMARY} opacity="0.6" />
      <path d="M40 28a4 4 0 010 60" stroke={MUTED} opacity="0.7" />
      <path d="M70 80l6 4 6-4" stroke={ACCENT} />
    </>,
    className
  );
}