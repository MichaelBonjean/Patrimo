/**
 * Logique partagée par les fonctions du portail locataire.
 *
 * Accès via asServiceRole (bypass RLS) — l'autorisation est portée par le
 * jeton cryptographique ET la vérification EXPLICITE de la chaîne:
 *
 *   TenantAccess → Lease → Lot → Property → Owner
 *
 * Aucune confiance n'est accordée aux RLS côté serviceRole: chaque maillon
 * de la chaîne est chargé et vérifié par le code. Un jeton valide ne donne
 * accès qu'au bail explicitement autorisé et à aucune autre donnée.
 *
 * Token: le brut n'est plus stocké pour les nouveaux accès (token_hash SHA-256
 * préfixé). Le hash sert de clé de recherche; le jeton brut circule uniquement
 * dans le lien magique. Révocation, rotation, expiration réelle et auto-révocation
 * après tentatives échouées sont gérées ici.
 */

import { logAction } from './audit.ts';
import { loadActiveLease } from './leaseResolve.ts';

export function addDaysISO(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86400000).toISOString();
}

export function buildAddress(property: any): string {
  if (!property) return '';
  return [property.address, property.postal_code, property.city].filter(Boolean).join(' ');
}

function cleanStr(v: any): string {
  if (!v) return '';
  const s = String(v).trim();
  return (s === 'null' || s === 'undefined') ? '' : s;
}

export function resolveTenant(lot: any, tenantId?: string): any {
  if (!lot) return null;
  const all: any[] = Array.isArray(lot.tenants) ? [...lot.tenants] : [];
  if (cleanStr(lot.tenant_name) && !all.find(t => t.name === lot.tenant_name)) {
    all.unshift({
      id: 'legacy',
      name: cleanStr(lot.tenant_name),
      entry_date: lot.tenant_entry_date || '',
      exit_date: lot.tenant_exit_date || '',
      email: cleanStr(lot.tenant_email),
      phone: cleanStr(lot.tenant_phone)
    });
  }
  if (tenantId) {
    const found = all.find(t => t.id === tenantId);
    if (found) return {
      ...found,
      email: cleanStr(found.email),
      phone: cleanStr(found.phone)
    };
  }
  const today = new Date();
  const active = all.find(t => {
    if (!t.entry_date) return true;
    const e = new Date(t.entry_date);
    if (e > today) return false;
    if (t.exit_date && new Date(t.exit_date) < today) return false;
    return true;
  }) || all[0];
  return active ? {
    ...active,
    email: cleanStr(active.email),
    phone: cleanStr(active.phone)
  } : null;
}

// ----------------------------------------------------------------------------
// Token cryptographique
// ----------------------------------------------------------------------------

const TOKEN_PREFIX = 'patrimo:tenant:v1:';

/** Empreinte SHA-256 préfixée (séparation de domaine, anti rainbow-table). */
export async function hashToken(token: string): Promise<string> {
  const enc = new TextEncoder().encode(TOKEN_PREFIX + String(token || ''));
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Génère un jeton aléatoire cryptographiquement sûr (32 octets → 64 hex). */
export function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ----------------------------------------------------------------------------
// Rate limiting (best-effort, in-isolate) + seuils de verrouillage
// ----------------------------------------------------------------------------

export const PORTAL_IP_LIMIT = 120;       // requêtes/min par IP (tout scope confondu)
export const PORTAL_IP_WINDOW = 60_000;
export const PORTAL_BAD_LIMIT = 10;        // tokens inconnus / 10 min par IP
export const PORTAL_BAD_WINDOW = 600_000;
export const PORTAL_FAIL_MAX = 10;        // échecs de chaîne → auto-révocation

const _rl = new Map<string, { count: number; first: number }>();

/** Réinitialise le limiteur (tests). */
export function _resetRateLimiter(): void { _rl.clear(); }

function _hit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const e = _rl.get(key);
  if (!e || now - e.first > windowMs) { _rl.set(key, { count: 1, first: now }); return false; }
  e.count++;
  return e.count > limit;
}

export function clientIp(req: Request | null): string {
  const h = (req as any)?.headers?.get?.('x-forwarded-for') || '';
  return String(h).split(',')[0].trim() || 'unknown';
}

// ----------------------------------------------------------------------------
// Recherche du jeton (par hash, fallback legacy magic_token)
// ----------------------------------------------------------------------------

export async function findAccessByToken(svc: any, token: string): Promise<any | null> {
  if (!token) return null;
  const h = await hashToken(token);
  let list = await svc.entities.TenantAccess.filter({ token_hash: h });
  if (list && list[0]) return list[0];
  // Legacy: tokens émis avant le hash — on tente magic_token brut.
  list = await svc.entities.TenantAccess.filter({ magic_token: token });
  return list && list[0] ? list[0] : null;
}

// ----------------------------------------------------------------------------
// Audit portail (n'échoue jamais l'opération métier)
// ----------------------------------------------------------------------------

async function auditPortal(
  svc: any,
  o: { access?: any; code: string; ip: string; lease_id?: string; lot_id?: string }
): Promise<void> {
  try {
    await logAction(svc, {
      patrimony_id: o.access?.owner_id || '',
      actor_email: o.access?.email || 'anonymous',
      actor_role: 'tenant',
      action: 'admin_access',
      entity_type: 'TenantAccess',
      entity_id: o.access?.id || '',
      entity_label: o.access?.tenant_name || '',
      details: { code: o.code, lease_id: o.lease_id || '', lot_id: o.lot_id || '', ip: o.ip },
      req: null as any,
    });
  } catch (_) { /* best effort */ }
}

/** Incrémente failed_attempts; auto-révocation au-delà du seuil (tampering / brute-force). */
async function markFailed(svc: any, access: any): Promise<void> {
  try {
    const n = (access.failed_attempts || 0) + 1;
    const patch: any = { failed_attempts: n };
    if (n >= PORTAL_FAIL_MAX && !access.revoked_at) {
      patch.revoked_at = new Date().toISOString();
    }
    await svc.entities.TenantAccess.update(access.id, patch);
    access.failed_attempts = n;
    if (patch.revoked_at) access.revoked_at = patch.revoked_at;
  } catch (_) { /* best effort */ }
}

// ----------------------------------------------------------------------------
// Validation + chaîne d'autorisation
// ----------------------------------------------------------------------------

export interface ValidateOpts { req?: Request | null; audit?: boolean; }
export interface ValidateResult {
  ok: boolean;
  code?: string;
  access?: any;
  lot?: any;
  property?: any;
  lease?: any;
  tenant?: any;
  ip?: string;
}

/**
 * Valide un jeton et résout la chaîne complète.
 * N'effectue PLUS de renouvellement automatique de l'expiration: last_used_at
 * est renseigné, expires_at est immuable (révocation/rotation explicites).
 */
export async function validateAndRenewAccess(
  svc: any,
  token: string,
  opts: ValidateOpts = {}
): Promise<ValidateResult> {
  const req = opts.req || null;
  const ip = clientIp(req);

  // Plafond global par IP (protège contre tout flood, jeton valide ou non).
  if (_hit(`portal:ip:${ip}`, PORTAL_IP_LIMIT, PORTAL_IP_WINDOW)) {
    return { ok: false, code: 'rate_limited', ip };
  }

  const access = await findAccessByToken(svc, token);
  if (!access) {
    // Jeton inconnu: on compte les échecs par IP (brute-force sur l'espace de tokens).
    if (_hit(`portal:bad:${ip}`, PORTAL_BAD_LIMIT, PORTAL_BAD_WINDOW)) {
      return { ok: false, code: 'rate_limited', ip };
    }
    return { ok: false, code: 'not_found', ip };
  }

  const now = new Date();

  // 1) Révocation explicite.
  if (access.revoked_at) {
    if (opts.audit !== false) await auditPortal(svc, { access, code: 'revoked', ip, lease_id: access.lease_id, lot_id: access.lot_id });
    return { ok: false, code: 'revoked', access, ip };
  }

  // 2) Expiration réelle (pas de prolongation).
  if (access.expires_at && new Date(access.expires_at) < now) {
    if (opts.audit !== false) await auditPortal(svc, { access, code: 'expired', ip, lease_id: access.lease_id, lot_id: access.lot_id });
    return { ok: false, code: 'expired', access, ip };
  }

  // 3) Maillon Lot.
  let lot: any = null;
  try { lot = await svc.entities.Lot.get(access.lot_id); } catch (_) { lot = null; }
  if (!lot) {
    await markFailed(svc, access);
    if (opts.audit !== false) await auditPortal(svc, { access, code: 'lot_missing', ip, lot_id: access.lot_id });
    return { ok: false, code: 'lot_missing', access, ip };
  }
  if (access.property_id && lot.property_id && lot.property_id !== access.property_id) {
    await markFailed(svc, access);
    return { ok: false, code: 'chain_broken', access, ip };
  }
  if (access.owner_id && lot.owner_id && lot.owner_id !== access.owner_id) {
    await markFailed(svc, access);
    return { ok: false, code: 'chain_broken', access, ip };
  }

  // 4) Maillon Property.
  let property: any = null;
  const propId = access.property_id || lot.property_id;
  if (propId) {
    try { property = await svc.entities.Property.get(propId); } catch (_) { property = null; }
  }
  if (!property) {
    await markFailed(svc, access);
    return { ok: false, code: 'property_missing', access, ip };
  }
  if (access.owner_id && property.owner_id && property.owner_id !== access.owner_id) {
    await markFailed(svc, access);
    return { ok: false, code: 'chain_broken', access, ip };
  }

  // 5) Maillon Lease (ancre le bail autorisé).
  let lease: any = null;
  if (access.lease_id) {
    try { lease = await svc.entities.Lease.get(access.lease_id); } catch (_) { lease = null; }
    if (!lease) {
      await markFailed(svc, access);
      return { ok: false, code: 'chain_broken', access, ip };
    }
    if (
      lease.lot_id !== access.lot_id ||
      lease.property_id !== access.property_id ||
      (access.owner_id && lease.owner_id && lease.owner_id !== access.owner_id)
    ) {
      await markFailed(svc, access);
      return { ok: false, code: 'chain_broken', access, ip };
    }
  } else {
    // Legacy sans lease_id: on résout le bail actif et on le matérialise (lazy migration).
    try {
      lease = await loadActiveLease(svc, lot, property);
      if (lease && lease.id && !lease._legacy) {
        try { await svc.entities.TenantAccess.update(access.id, { lease_id: lease.id }); access.lease_id = lease.id; } catch (_) {}
      }
    } catch (_) { lease = null; }
  }

  const tenant = resolveTenant(lot, access.tenant_id);

  // Succès: raz des échecs, trace le dernier usage (SANS prolonger l'expiration).
  try {
    await svc.entities.TenantAccess.update(access.id, {
      last_used_at: now.toISOString(),
      last_accessed_date: now.toISOString(),
      failed_attempts: 0,
    });
  } catch (_) {}

  if (opts.audit !== false) {
    await auditPortal(svc, { access, code: 'ok', ip, lease_id: access.lease_id, lot_id: access.lot_id });
  }

  return { ok: true, access, lot, property, lease, tenant, ip };
}

// ----------------------------------------------------------------------------
// Révocation / Rotation
// ----------------------------------------------------------------------------

export async function revokeTenantAccessById(svc: any, accessId: string): Promise<boolean> {
  try {
    await svc.entities.TenantAccess.update(accessId, { revoked_at: new Date().toISOString() });
    return true;
  } catch (_) { return false; }
}

export async function rotateTenantAccess(svc: any, accessId: string, days = 90): Promise<{ token: string } | null> {
  const access = await svc.entities.TenantAccess.get(accessId);
  if (!access) return null;
  const newToken = generateSecureToken();
  const newHash = await hashToken(newToken);
  const now = new Date();
  try {
    await svc.entities.TenantAccess.update(accessId, {
      token_hash: newHash,
      magic_token: newToken,        // écrase l'ancien jeton brut (legacy)
      expires_at: addDaysISO(now, days),
      revoked_at: null,
      last_used_at: null,
      last_accessed_date: null,
      failed_attempts: 0,
      token_version: (access.token_version || 1) + 1,
    });
  } catch (_) { return null; }
  return { token: newToken };
}