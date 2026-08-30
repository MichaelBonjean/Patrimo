/**
 * Utility to scope entity queries to the current authenticated user.
 * Import `useOwnerFilter` in React components to get the `withOwner` helper.
 * For non-hook contexts (rare), import `withOwnerEmail` and pass the email directly.
 */

import { useAuth } from '@/lib/AuthContext';

/**
 * React hook — returns a `withOwner` function bound to the current user's email.
 *
 * Usage:
 *   const { withOwner } = useOwnerFilter();
 *   queryFn: () => base44.entities.Transaction.filter(withOwner({ year: 2025 }))
 */
export function useOwnerFilter() {
  const { user } = useAuth();
  const email = user?.email || '';

  /**
   * Retourne un filtre scoped à l'utilisateur.
   * Si l'email est vide (auth pas encore chargée), retourne le filtre sans owner_id
   * pour ne pas bloquer les requêtes.
   */
  const withOwner = (filters = {}) => {
    if (!email) return filters;
    return { ...filters, owner_id: email };
  };

  return { withOwner, ownerEmail: email };
}

/**
 * Non-hook helper — pass the email explicitly.
 */
export function withOwnerEmail(email, filters = {}) {
  return { ...filters, owner_id: email };
}