import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/**
 * computeAutomationRate — KPI "Taux d'automatisation".
 *
 *   Taux = actions traitées automatiquement / actions totales traitées × 100
 *
 * CALCUL DOCUMENTÉ (aucune manipulation) — chaque catégorie compte des
 * ACTIONS RÉELLES issues des entités (créées dans le mois) :
 *
 *  1. classification   — DocumentImport traités (committed/rejected) du mois.
 *                        auto = confiance classification ≥ 0.75
 *                        manuel = confiance < 0.75 (passé en revue/validation)
 *  2. extraction       — DocumentImport du mois avec OCR/données extraites.
 *                        auto = 100 % (extraction systématique à l'ingestion)
 *  3. creation_maj     — enregistrements créés dans le mois.
 *                        auto = issus d'un import (created_from_entities des imports commités)
 *                        manuel = créés hors import (saisie formulaire)
 *  4. rapprochement    — BankTransaction traitées (linked/ignored) du mois.
 *                        auto = linked (moteur/règle) ; manuel = ignored (écartée à la main)
 *                        pending = en attente (exclue du total)
 *  5. categorisation   — Transaction du mois.
 *                        auto = avec bank_import_id (catégorisées à l'import)
 *                        manuel = sans bank_import_id (saisie manuelle)
 *  6. quittance        — Quittance générées dans le mois. auto = 100 %.
 *  7. impayes          — Impayé détectés dans le mois. auto = 100 % (moteur).
 *  8. rent_dues        — RentDue générées dans le mois. auto = 100 %.
 *  9. alertes         — Alert créées dans le mois.
 *                        auto = actor = cron/système ; manuel = actor = email bailleur
 * 10. background_jobs  — JobRun du mois.
 *                        auto = success ; manuel = error (intervention requise)
 *
 * Payload : { year?, month? }  ( défaut = mois courant )
 * Retour : { ok, period, rate, totals, categories[], history[], methodology }
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const owner = user.email;
    const svc = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch (_e) { /* vide */ }
    const now = new Date();
    const y = body.year ? Number(body.year) : now.getFullYear();
    const m = body.month ? Number(body.month) : now.getMonth() + 1;
    const period = `${y}-${String(m).padStart(2, '0')}`;

    const [imports, props, lots, leases, holders, rentDues, quittances, impayes, revisions, alerts, transactions, payments, bankTx, jobRuns] = await Promise.all([
      svc.entities.DocumentImport.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Property.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Lot.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Lease.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Holder.filter({ owner_id: owner }).catch(() => []),
      svc.entities.RentDue.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Quittance.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Impaye.filter({ owner_id: owner }).catch(() => []),
      svc.entities.RentRevision.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Alert.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Transaction.filter({ owner_id: owner }).catch(() => []),
      svc.entities.Payment.filter({ owner_id: owner }).catch(() => []),
      svc.entities.BankTransaction.filter({ owner_id: owner }).catch(() => []),
      svc.entities.JobRun.filter({ owner_id: owner }).catch(() => []),
    ]);

    const key = (d: any) => String(d?.created_date || '').slice(0, 7);
    const inMonth = (arr: any[], mo: string) => (arr || []).filter((x: any) => key(x) === mo);

    // Pré-calcul : enregistrements métier créés (pour creation_maj manuel).
    const businessEntities = [props, lots, leases, holders, rentDues, quittances, impayes, revisions, alerts, transactions, payments];
    const businessCreatedIn = (mo: string) => businessEntities.reduce((s, arr) => s + inMonth(arr, mo).length, 0);

    const autoFromImports = (mo: string) => {
      const committed = inMonth(imports, mo).filter((d: any) => d.status === 'committed');
      return committed.reduce((s: number, d: any) => s + ((d.created_from_entities || []).length), 0);
    };

    function monthStats(mo: string) {
      // 1. classification
      const cls = inMonth(imports, mo).filter((d: any) => d.status === 'committed' || d.status === 'rejected');
      const clsAuto = cls.filter((d: any) => Number(d.classification_confidence || 0) >= 0.75).length;
      // 2. extraction
      const extr = inMonth(imports, mo).filter((d: any) => (d.ocr_text && d.ocr_text.trim()) || (d.extracted_data && Object.keys(d.extracted_data).length));
      // 3. creation_maj
      const creaAuto = autoFromImports(mo);
      const creaTotal = businessCreatedIn(mo);
      const creaManual = Math.max(0, creaTotal - creaAuto);
      // 4. rapprochement
      const rec = inMonth(bankTx, mo).filter((t: any) => t.status === 'linked' || t.status === 'ignored');
      const recAuto = rec.filter((t: any) => t.status === 'linked').length;
      const recPending = inMonth(bankTx, mo).filter((t: any) => t.status === 'pending').length;
      // 5. categorisation
      const cat = inMonth(transactions, mo);
      const catAuto = cat.filter((t: any) => !!t.bank_import_id).length;
      const catManual = cat.length - catAuto;
      // 6-9
      const quit = inMonth(quittances, mo);
      const imp = inMonth(impayes, mo);
      const rd = inMonth(rentDues, mo);
      const al = inMonth(alerts, mo);
      const alAuto = al.filter((a: any) => !a.actor || a.actor === 'cron' || a.actor === 'systeme').length;
      const alManual = al.length - alAuto;
      // 10. background jobs
      const jr = inMonth(jobRuns, mo);
      const jrAuto = jr.filter((j: any) => j.status === 'success').length;
      const jrManual = jr.filter((j: any) => j.status === 'error').length;

      const categories = [
        { key: 'classification', label: 'Classification document', auto: clsAuto, manual: cls.length - clsAuto, total: cls.length },
        { key: 'extraction', label: 'Extraction (OCR/IA)', auto: extr.length, manual: 0, total: extr.length },
        { key: 'creation_maj', label: 'Création / mise à jour', auto: creaAuto, manual: creaManual, total: creaAuto + creaManual },
        { key: 'rapprochement', label: 'Rapprochement paiement', auto: recAuto, manual: rec.length - recAuto, total: rec.length, pending: recPending },
        { key: 'categorisation', label: 'Catégorisation', auto: catAuto, manual: catManual, total: cat.length },
        { key: 'quittance', label: 'Quittance', auto: quit.length, manual: 0, total: quit.length },
        { key: 'impayes', label: 'Impayé', auto: imp.length, manual: 0, total: imp.length },
        { key: 'rent_dues', label: 'Échéances de loyer', auto: rd.length, manual: 0, total: rd.length },
        { key: 'alertes', label: 'Alertes', auto: alAuto, manual: alManual, total: al.length },
        { key: 'background_jobs', label: 'Jobs de fond', auto: jrAuto, manual: jrManual, total: jrAuto + jrManual },
      ];

      const auto = categories.reduce((s, c) => s + c.auto, 0);
      const manual = categories.reduce((s, c) => s + c.manual, 0);
      const total = auto + manual;
      const pending = categories.reduce((s, c) => s + (c.pending || 0), 0);
      const rate = total > 0 ? Math.round((auto / total) * 1000) / 10 : null;
      return { period: mo, auto, manual, total, pending, rate, categories };
    }

    const current = monthStats(period);

    // Historique 12 mois (incluant le mois courant), du plus ancien au plus récent.
    const history: any[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      const mo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const s = monthStats(mo);
      history.push({ period: mo, label: mo.slice(5) + '/' + mo.slice(2, 4), rate: s.rate, auto: s.auto, total: s.total });
    }

    const methodology =
      "Taux = actions automatiques / actions traitées × 100. " +
      "Comptages réels depuis les entités (créées dans le mois). " +
      "Classification auto = confiance ≥ 0.75. Extraction = 100 % automatique à l'ingestion. " +
      "Création auto = enregistrements issus d'un import (created_from_entities) ; manuel = créés hors import. " +
      "Rapprochement auto = BankTransaction linked (moteur/règle) ; manuel = ignored ; pending exclue du total. " +
      "Catégorisation auto = Transaction avec bank_import_id ; manuel = saisie sans import. " +
      "Quittance/Impayé/Échéances = 100 % automatiques (générés par le système). " +
      "Alertes auto = cron/système ; manuel = email bailleur. Jobs auto = success ; manuel = error. " +
      "Aucune donnée n'est artificiellement majorée.";

    return Response.json({
      ok: true, period, rate: current.rate, totals: { auto: current.auto, manual: current.manual, total: current.total, pending: current.pending },
      categories: current.categories, history, methodology,
    });
  } catch (error) {
    return Response.json({ error: (error as any)?.message || 'erreur' }, { status: 500 });
  }
}