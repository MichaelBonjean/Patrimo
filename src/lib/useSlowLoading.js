import { useEffect, useState } from 'react';

/**
 * Renvoie `true` uniquement quand le chargement dure plus de `delay` ms.
 * Permet d'afficher un message descriptif (et non un simple spinner) sur les opérations longues.
 * @param {boolean} isLoading - état de chargement observé
 * @param {number} delay - seuil en ms avant de considérer le chargement comme "long"
 */
export function useSlowLoading(isLoading, delay = 2000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setSlow(false);
      return undefined;
    }
    const t = setTimeout(() => setSlow(true), delay);
    return () => clearTimeout(t);
  }, [isLoading, delay]);
  return slow;
}