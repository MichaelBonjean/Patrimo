// Stub du runtime base44 (secrets, waitUntil) pour le resolver Vitest.
// Vite a besoin de résoudre l'import "base44:runtime" à l'analyse, même quand
// la spec le mocke ensuite via vi.mock('base44:runtime'). On pointe donc vers
// ce stub ; les specs qui veulent des valeurs réelles remplacent le module.
export const secrets = { get: () => undefined };
export const waitUntil = async () => {};