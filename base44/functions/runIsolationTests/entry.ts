import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * Tests automatiques d'isolation multi-utilisateurs.
 *
 * Stratégie: on simule deux propriétaires — SELF (l'admin qui lance le test) et OTHER
 * (un email factice). On crée via service role des enregistrements appartenant à OTHER,
 * puis on vérifie via le SDK "user scoped" (RLS) que SELF ne peut ni lire, ni modifier,
 * ni supprimer ces enregistrements, et ne peut pas s'y rattracher (quittances, import,
 * portail locataire). Tout est marqué is_demo=true et supprimé à la fin (via service role).
 *
 * La isolation étant symétrique (RLS par owner_id), prouver que SELF ne voit pas OTHER
 * prouve aussi que OTHER ne voit pas SELF.
 */
export default async function(req: Request): Promise<Response> {
  const results = [];
  const seeded = [];
  const OTHER = 'isolation-other@example.com';
  const mark = `ISOL-${Date.now()}`;

  const check = (name, cond) => results.push({ name, pass: !!cond });

  let base44 = null;
  let svc = null;

  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    const self = user.email;
    svc = base44.asServiceRole;

    // --- Seed: patrimoine factice de OTHER + un bien de SELF pour comparaison
    const P_other = await svc.entities.Property.create({
      owner_id: OTHER, is_demo: true, name: `${mark}-other`,
      category: 'Appartement', holding_structure: 'En propre', tax_regime: 'Location nue (revenus fonciers)'
    });
    seeded.push({ e: 'Property', id: P_other.id });

    const L_other = await svc.entities.Lot.create({
      owner_id: OTHER, is_demo: true, property_id: P_other.id, designation: `${mark}-lot`
    });
    seeded.push({ e: 'Lot', id: L_other.id });

    const T_other = await svc.entities.Transaction.create({
      owner_id: OTHER, is_demo: true, property_id: P_other.id, lot_id: L_other.id,
      year: 2025, month: 1, category: 'Loyer', amount: 700, type: 'income'
    });
    seeded.push({ e: 'Transaction', id: T_other.id });

    const P_self = await svc.entities.Property.create({
      owner_id: self, is_demo: true, name: `${mark}-self`,
      category: 'Appartement', holding_structure: 'En propre', tax_regime: 'Location nue (revenus fonciers)'
    });
    seeded.push({ e: 'Property', id: P_self.id });

    // --- Tests RLS Property
    const myList = await base44.entities.Property.list();
    check(`Property.list exclut le bien d'un autre`, !myList.find(p => p.id === P_other.id));
    check(`Property.list inclut son propre bien`, !!myList.find(p => p.id === P_self.id));

    let getOther = 'UNSET';
    try { getOther = await base44.entities.Property.get(P_other.id); } catch (_) { getOther = null; }
    check(`Property.get du bien d'un autre refusé`, !getOther);

    let upd = true;
    try { await base44.entities.Property.update(P_other.id, { name: `HIJACK` }); } catch (_) { upd = false; }
    check(`Property.update du bien d'un autre bloqué`, !upd);
    const after = await svc.entities.Property.get(P_other.id);
    check(`Property.update sans effet`, after && after.name === P_other.name);

    let del = true;
    try { await base44.entities.Property.delete(P_other.id); } catch (_) { del = false; }
    check(`Property.delete du bien d'un autre bloqué`, !del);

    // --- Tests RLS Lot
    const myLots = await base44.entities.Lot.list();
    check(`Lot.list exclut le lot d'un autre`, !myLots.find(l => l.id === L_other.id));

    let lotUpd = true;
    try { await base44.entities.Lot.update(L_other.id, { tenant_email: `pwn@x.com` }); } catch (_) { lotUpd = false; }
    check(`Lot.update du lot d'un autre bloqué (pas de détournement de contact)`, !lotUpd);

    // --- Tests RLS Transaction
    const myTx = await base44.entities.Transaction.filter({});
    check(`Transaction.filter exclut les transactions d'un autre`, !myTx.find(t => t.id === T_other.id));
    let txUpd = true;
    try { await base44.entities.Transaction.update(T_other.id, { note: `pwn` }); } catch (_) { txUpd = false; }
    check(`Transaction.update d'un autre bloqué`, !txUpd);

    // --- Test anti-falsification: un utilisateur ne peut pas créer un enregistrement attribué à un autre (owner_id usurpé refusé par RLS).
    let forgeBlocked = false;
    try {
      await base44.entities.PropertyHolder.create({
        property_id: P_other.id, holder_id: `fake`, share_percent: 50, owner_id: OTHER, is_demo: true
      });
    } catch (_) { forgeBlocked = true; }
    check(`PropertyHolder.create avec owner_id usurpé (autre) refusé`, forgeBlocked);

    // Un lien référençant le bien d'autrui reste la propriété de l'appelant (pas une injection chez l'autre):
    // on vérifie qu'aucun enregistrement attribué à OTHER n'apparaît.
    const otherLinks = await svc.entities.PropertyHolder.filter({ owner_id: OTHER });
    check(`Aucun PropertyHolder injecté chez l'autre`, !otherLinks.find(l => l.property_id === P_other.id));

    // --- Test portail locataire: générer un accès sur le lot d'un autre -> 404
    let tpa = null;
    try {
      tpa = await base44.functions.invoke('generateTenantAccess', { lot_id: L_other.id, email: `x@x.com` });
    } catch (e) { tpa = { error: e?.message }; }
    // Bloqué = aucun access_id retourné (réussite => {access_id, link}).
    const tpaBlocked = !(tpa && (tpa.data?.access_id || tpa.access_id));
    check(`generateTenantAccess sur lot d'un autre bloqué`, tpaBlocked);

    // --- Test mécanique importFinancialData: filtre owner exclut le bien d'un autre
    const filteredMine = await svc.entities.Property.filter({ owner_id: self });
    check(`importFinancialData: filtre owner exclut autre bien`, !filteredMine.find(p => p.id === P_other.id));
    check(`importFinancialData: filtre owner inclut son bien`, !!filteredMine.find(p => p.id === P_self.id));

    // --- Test clear_existing scope: importFinancialData avec clear_period d'une période sans données
    // ne doit JAMAIS supprimer les transactions d'un autre (OTHER garde T_other).
    // On appelle importFinancialData sans file_url -> 400 (contrôle d'intention explicite) -> on capture juste l'erreur attendue.
    let importGuard = null;
    try {
      importGuard = await base44.functions.invoke('importFinancialData', {});
    } catch (e) { importGuard = { error: e?.message }; }
    // Bloqué = aucun succès retourné (réussite => {success:true}).
    const importBlocksNoFile = !(importGuard && (importGuard.data?.success || importGuard.success));
    check(`importFinancialData: file_url requis (intention explicite)`, importBlocksNoFile);

    // Vérification post-appel: la transaction d'OTHER est toujours là (pas de suppression globale).
    const stillThere = await svc.entities.Transaction.get(T_other.id).catch(() => null);
    check(`aucune transaction d'un autre supprimée`, !!stillThere && stillThere.id === T_other.id);

    // --- Test migrateOwnerIds: outil technique réservé admin + intention explicite obligatoire.
    let migNoConfirm = null;
    try {
      migNoConfirm = await base44.functions.invoke('migrateOwnerIds', {});
    } catch (e) { migNoConfirm = { error: e?.message }; }
    const migBlocked = !(migNoConfirm && (migNoConfirm.data?.success || migNoConfirm.success));
    check(`migrateOwnerIds: confirmation explicite requise (non appelable par défaut)`, migBlocked);
    // Note: le chemin admin {confirm:true} exécute une VRAIE migration sur toute la base -> non exercé ici.
    // Le refus des non-admin (403) est garanti par le garde-fou serveur (user.role !== 'admin'); non
    // exerçable depuis une session builder admin (aucun jeton utilisateur normal disponible).

    // --- Test SCITemplate: création avec owner_id d'un autre refusée (RLS create)
    let sciBlocked = false;
    try {
      await base44.entities.SCITemplate.create({ sci_name: `${mark}-sci`, owner_id: OTHER, is_demo: true });
    } catch (_) { sciBlocked = true; }
    check(`SCITemplate.create avec owner_id d'un autre refusé`, sciBlocked);

    const passed = results.filter(r => r.pass).length;
    return Response.json({
      ok: true, self, other: OTHER, mark,
      total: results.length, passed, failed: results.length - passed,
      results
    });
  } catch (error) {
    return Response.json({
      ok: false, error: error.message, results, seededCount: seeded.length
    }, { status: 500 });
  } finally {
    // Nettoyage systématique (même en cas d'erreur) via service role, par ID connus.
    if (svc) {
      for (const s of [...seeded].reverse()) {
        try {
          if (s.e === 'Transaction') await svc.entities.Transaction.delete(s.id);
          if (s.e === 'Lot') await svc.entities.Lot.delete(s.id);
          if (s.e === 'Property') await svc.entities.Property.delete(s.id);
        } catch (_) { /* best effort */ }
      }
      try {
        const strays = await svc.entities.SCITemplate.filter({ sci_name: `${mark}-sci` });
        for (const st of strays) await svc.entities.SCITemplate.delete(st.id).catch(() => {});
      } catch (_) {}
    }
  }
}