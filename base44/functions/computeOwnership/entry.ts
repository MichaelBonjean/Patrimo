import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  computePropertyShare,
  computePropertyOwnershipBreakdown,
  detectCycles,
  findOrphanMembers,
  findOwnerIncoherences
} from '../../shared/ownership.ts';

/**
 * computeOwnership — détermine la détention économique finale d'un détenteur dans un bien,
 * au travers d'une chaîne arbitraire de structures intermédiaires (Personne → SCI A → SCI B → Bien).
 *
 * Entrée: { property_id, holder_id? }
 *   - holder_id fourni: renvoie la part économique de CE déteneur (personne ou structure) sur le bien.
 *   - holder_id omis: renvoie la répartition économique entre toutes les personnes physiques.
 *
 * Sécurité: authentification obligatoire; toutes les lectures sont filtrées par owner_id = utilisateur.
 * Aucune donnée d'un autre propriétaire n'est lue ni calculée.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Authentification requise.' }, { status: 401 });
    const owner = user.email;
    const svc = base44.asServiceRole;

    const body = await req.json().catch(() => ({}));
    if (!body || !body.property_id) {
      return Response.json({ error: 'property_id requis.' }, { status: 400 });
    }

    // ISOLATION: toutes les lectures filtrées par owner_id.
    const [properties, holders, members, propertyHolders] = await Promise.all([
      svc.entities.Property.filter({ owner_id: owner }),
      svc.entities.Holder.filter({ owner_id: owner }),
      svc.entities.HolderMember.filter({ owner_id: owner }),
      svc.entities.PropertyHolder.filter({ owner_id: owner })
    ]);

    const property = properties.find(p => p.id === body.property_id);
    if (!property) {
      return Response.json({ error: 'Bien introuvable dans votre patrimoine.' }, { status: 404 });
    }

    // Contrôle de cohérence du modèle (cycles, orphelins, owner_id).
    const cycles = detectCycles(members);
    const orphanMembers = findOrphanMembers(members, holders);
    const incoherences = findOwnerIncoherences({ holders, members, propertyHolders });
    const orphanPropertyHolders = propertyHolders
      .filter(l => !holders.find(h => h.id === l.holder_id))
      .map(l => ({ id: l.id, holder_id: l.holder_id, property_id: l.property_id }));

    // Total des parts directes déclarées sur le bien (contrôle: doit être 100%).
    const directShareTotal = propertyHolders
      .filter(l => l.property_id === property.id)
      .reduce((s, l) => s + (l.share_percent || 0), 0);

    const warnings: any[] = [];

    if (body.holder_id) {
      // Vérifie que le détenteur demandé appartient bien au propriétaire.
      const target = holders.find(h => h.id === body.holder_id);
      if (!target) {
        return Response.json({ error: 'Détenteur introuvable dans votre patrimoine.' }, { status: 404 });
      }
      const share = computePropertyShare({
        personId: body.holder_id,
        propertyId: property.id,
        members, propertyHolders, warnings
      });
      return Response.json({
        ok: true,
        owner,
        property: { id: property.id, name: property.name },
        holder: { id: target.id, name: target.name, type: target.type },
        economic_percent: Math.round(share * 10000) / 100,
        direct_share_total_percent: directShareTotal,
        model_warnings: { cycles, orphan_members: orphanMembers, owner_incoherences: incoherences, orphan_property_holders: orphanPropertyHolders },
        computation_warnings: warnings
      });
    }

    // Sans holder_id: répartition économique entre toutes les personnes physiques.
    const breakdown = computePropertyOwnershipBreakdown({
      propertyId: property.id, holders, members, propertyHolders
    });
    return Response.json({
      ok: true,
      owner,
      property: { id: property.id, name: property.name },
      economic_breakdown: breakdown.rows,
      direct_share_total_percent: directShareTotal,
      model_warnings: { cycles, orphan_members: orphanMembers, owner_incoherences: incoherences, orphan_property_holders: orphanPropertyHolders },
      computation_warnings: breakdown.warnings
    });
  } catch (error) {
    console.error('[computeOwnership] erreur:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
}