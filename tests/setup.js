// Setup global Vitest : matchers DOM (toBeInTheDocument, …) pour React Testing Library.
import '@testing-library/jest-dom/vitest';

// Polyfill crypto.subtle pour jsdom (hashToken / generateSecureToken du portail locataire).
// jsdom expose crypto.getRandomValues mais pas subtle ; on branche le webcrypto de Node.
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto || !globalThis.crypto.subtle) {
  const { webcrypto } = require('crypto');
  globalThis.crypto = webcrypto;
}

// jsdom ne fournit pas ResizeObserver (utilisé par cmdk / Radix) — polyfill no-op.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom n'implémente pas Element.scrollIntoView (appelé par cmdk au mount) — polyfill no-op.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}