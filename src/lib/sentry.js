import * as Sentry from '@sentry/react';
import { base44 } from '@/api/base44Client';

let initialized = false;

/**
 * Deterministic, non-reversible hash so we never send a raw user id to Sentry.
 */
function hashId(str) {
  const s = String(str || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'u_' + (h >>> 0).toString(36);
}

function isEnabled() {
  return Boolean(import.meta.env.VITE_SENTRY_DSN);
}

/**
 * Initialize Sentry (error capture only). Stays inert until VITE_SENTRY_DSN
 * is configured. Release tag is set per-deployment from VITE_SENTRY_RELEASE /
 * VITE_APP_VERSION so each deploy is traceable.
 */
export function initSentry() {
  if (initialized || !isEnabled()) return;
  initialized = true;

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.PROD ? 'production' : 'development',
    release: import.meta.env.VITE_SENTRY_RELEASE || import.meta.env.VITE_APP_VERSION || 'dev',
    tracesSampleRate: 0,
    attachStacktrace: true,
    // never forward potentially sensitive data
    sendDefaultPii: false,
  });

  // anonymized user id so we can group events per user without identifying them
  base44
    .auth
    .me()
    .then((user) => {
      if (user && user.id) Sentry.setUser({ id: hashId(user.id) });
    })
    .catch(() => {
      /* not logged in — nothing to tag */
    });
}

export function captureError(err, context) {
  if (!isEnabled()) return null;
  return Sentry.captureException(err, context);
}

export function captureComponentError(err, info) {
  if (!isEnabled()) return null;
  return Sentry.captureException(err, {
    extra: { componentStack: info?.componentStack || '' },
  });
}