// checkServices : status public des services (App, Base44, Stripe).
// Côté serveur pour éviter les problèmes CORS côté navigateur.

async function withTimeout(url: string, opts: RequestInit = {}, ms = 6000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function base44Status(): Promise<string> {
  // Base44 expose un status page public (Statuspage). Best-effort.
  try {
    const res = await withTimeout("https://status.base44.com/api/v2/status.json", { headers: { "User-Agent": "patrimo" } });
    if (res.ok) {
      const data: any = await res.json();
      const indicator = data?.status?.indicator;
      if (indicator === "operational") return "operational";
      if (indicator === "minor" || indicator === "major") return "degraded";
      return "degraded";
    }
    return "unknown";
  } catch (_) {
    return "unknown";
  }
}

async function stripeStatus(): Promise<string> {
  try {
    const res = await withTimeout("https://api.stripe.com", { method: "GET" }, 6000);
    // 401/200/任何 réponse HTTP = joignable
    if (res.status === 401 || res.status === 200 || res.status === 404 || res.status === 405) return "up";
    return "up"; // joignable
  } catch (_) {
    return "down";
  }
}

export default async function (_req: Request): Promise<Response> {
  const checked_at = new Date().toISOString();
  const app = "up"; // si on exécute cette fonction, l'app répond
  const base44 = await base44Status();
  const stripe = await stripeStatus();
  return Response.json({ ok: true, app, base44, stripe, checked_at });
}