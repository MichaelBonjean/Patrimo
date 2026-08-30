// Façade frontend du moteur des transferts inter-comptes (ré-export du module partagé TS).
// Importer depuis @/lib/transferEngine — jamais reproduire la détection ailleurs.

export { detectTransferPairs, groupLinkedPairs, labelsMatch } from '../../base44/shared/transferEngine';