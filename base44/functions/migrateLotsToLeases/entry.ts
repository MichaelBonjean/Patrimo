import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { cleanStr, computeLeaseStatus, todayISO } from '../../shared/leaseResolve.ts';

function getLotTenants(lot: any): any[] {
  const arr = Array.isArray(lot.tenants) ? [...lot.tenants] : [];
  if (cleanStr(lot.tenant_name) && !arr.find((t) => t.name === lot.tenant_name)) {
    arr.unshift({
      id: 'legacy',
      name: cleanStr(lot.tenant_name),
      entry_date: lot.tenant_entry_date || '',
      exit_date: lot.tenant_exit_date || '',
      email: cleanStr(lot.tenant_email),
      phone: cleanStr(lot.tenant_phone),
    });
  }
  return arr;
}

function buildLeaseFromLot(lot: any, kind: 'current' | 'previous', sources: any[]): any {
  const leaseType = lot.lease_type || (lot.furnished ? 'Meublé' : 'Vide-Nu');
  const start = sources.map((s) => s.entry_date).filter(Boolean).sort()[0] || lot.tenant_entry_date || '';
  const end = sources.map((s) => s.exit_date).filter(Boolean).sort().reverse()[0] || '';
  const tenants = sources.map((t) => ({
    id: t.id || undefined,
    name: t.name,
    entry_date: t.entry_date || '',
    exit_date: t.exit_date || '',
    email: cleanStr(t.email),
    phone: cleanStr(t.phone),
  }));
  return {
    property_id: lot.property_id,
    lot_id: lot.id,
    lease_type: leaseType,
    date_start: start,
    date_end: end || null,
    status: computeLeaseStatus({ date_start: start, date_end: end }),
    tenants,
    rent_excluding_charges: lot.rent_excluding_charges || 0,
    charges: lot.charges || 0,
    deposit: lot.deposit || 0,
    due_day: 5,
    payment_frequency: 'mensuel',
    indexation_type: 'aucune',
    furnished: !!lot.furnished,
    notes: kind === 'previous' ? 'Bail historique migré depuis lot.previous_tenants' : '',
    migrated_from: 'lot_migration_v1',
  };
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    let payload: any = {};
    try { payload = await req.json(); } catch (_) { payload = {}; }
    if (!payload?.confirm) {
      return Response.json(
        { error: 'Confirmation requise: passez { confirm: true } pour lancer la migration.' },
        { status: 400 }
      );
    }

    const svc = base44.asServiceRole;
    const lots = await svc.entities.Lot.list(5000);
    const existing = await svc.entities.Lease.list(5000);

    // Index d'idempotence par (lot_id, date_start, premier locataire).
    const existingKeys = new Set<string>();
    for (const l of existing) {
      const t0 = (l.tenants || [])[0]?.name || '';
      existingKeys.add(`${l.lot_id}|${l.date_start || ''}|${t0}`);
    }

    let created = 0;
    let skipped = 0;
    let lotsWithoutTenants = 0;
    const details: any[] = [];
    const BATCH = 25;

    const batch: any[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const chunk = batch.splice(0, BATCH);
      try {
        await svc.entities.Lease.bulkCreate(chunk);
      } catch (e) {
        for (const rec of chunk) {
          try { await svc.entities.Lease.create(rec); created++; } catch (_) { skipped++; }
        }
      }
    };

    for (const lot of lots) {
      const owner = lot.owner_id || lot.created_by || user.email;
      if (!owner) { skipped++; continue; }

      const current = getLotTenants(lot);
      const previous = Array.isArray(lot.previous_tenants) ? lot.previous_tenants : [];

      if (current.length === 0 && previous.length === 0) {
        lotsWithoutTenants++;
        continue;
      }

      // Bail courant (tenants[] ou tenant_name legacy).
      if (current.length > 0) {
        const lease = buildLeaseFromLot(lot, 'current', current);
        const key = `${lease.lot_id}|${lease.date_start || ''}|${lease.tenants[0]?.name || ''}`;
        if (existingKeys.has(key)) {
          skipped++;
        } else if (!lease.date_start) {
          // Sans date d'entrée on ne peut pas créer un bail cohérent.
          skipped++;
          details.push({ lot_id: lot.id, reason: 'no_start_date' });
        } else {
          batch.push({ owner_id: owner, is_demo: lot.is_demo || false, ...lease });
          existingKeys.add(key);
          created++;
          if (batch.length >= BATCH) await flush();
        }
      }

      // Baux historiques (previous_tenants) — un bail par ancien locataire.
      for (const pt of previous) {
        if (!pt.name) continue;
        const lease = buildLeaseFromLot(lot, 'previous', [pt]);
        lease.rent_excluding_charges = pt.rent || lot.rent_excluding_charges || 0;
        const key = `${lease.lot_id}|${lease.date_start || ''}|${pt.name}`;
        if (existingKeys.has(key)) { skipped++; continue; }
        if (!lease.date_start) { skipped++; details.push({ lot_id: lot.id, reason: 'no_start_date_prev' }); continue; }
        batch.push({ owner_id: owner, is_demo: lot.is_demo || false, ...lease });
        existingKeys.add(key);
        created++;
        if (batch.length >= BATCH) await flush();
      }
    }

    await flush();

    return Response.json({
      ok: true,
      total_lots: lots.length,
      leases_existing_before: existing.length,
      created,
      skipped,
      lots_without_tenants: lotsWithoutTenants,
      details: details.slice(0, 50),
      launched_by: user.email,
      date: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}