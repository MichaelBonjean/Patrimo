import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
// force-restart: clean .vite
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors (force-restart: clean .vite)
  resolve: {
    // Single copy of React/ReactDOM across optimized dep chunks.
    dedupe: ['react', 'react-dom', 'scheduler']
  },
  // React/ReactDOM sont servis via l'interop CJS→ESM native de Vite (wrapper
  // __vite__cjsImport) qui expose TOUJOURS les exports nommés (useEffect, …).
  // L'optimiseur esbuild de Vite 6 omet `__toESM` pour react (CJS non statiquement
  // analysable via `module.exports = require('./cjs/react.development.js')`),
  // produisant un chunk `react.js` n'exportant que `default` → `useEffect`
  // undefined / "Cannot read properties of null (reading 'useEffect')" lors des
  // ré-optimisations différées (lazy). On les exclut donc de l'optimisation.
  optimizeDeps: {
    exclude: ['react', 'react-dom', 'react-dom/client', 'scheduler'],
    // Toutes les surfaces d'entrée de React + les libs lourdes chargées en
    // `lazy()` (pages du routeur) doivent être pré-bundlées dans la passe
    // initiale. Sinon, leur découverte différée déclenche une 2e passe
    // d'optimisation à la volée : `react` et `react-dom` se retrouvent alors
    // sur deux chunks `?v=` différents simultanément → "Invalid hook call" /
    // useEffect is null (deux copies de React en mémoire).
    include: [
      'react-router-dom',
      'react-router',
      '@tanstack/react-query',
      'recharts',
      'framer-motion',
      'lucide-react',
      'date-fns',
      'lodash',
      'react-markdown',
      'react-quill',
      'react-leaflet',
      '@hello-pangea/dnd',
      'three',
      'class-variance-authority',
      'clsx',
      'tailwind-merge',
      'cmdk',
      'sonner',
      'vaul',
      'react-day-picker',
      'react-resizable-panels',
      'embla-carousel-react',
      'input-otp',
      'next-themes',
      'react-hook-form',
      '@hookform/resolvers',
      'zod',
      'fuse.js',
      'xlsx',
      'jspdf',
      'canvas-confetti',
      '@sentry/react',
      '@radix-ui/react-accordion',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-aspect-ratio',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-collapsible',
      '@radix-ui/react-context-menu',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-hover-card',
      '@radix-ui/react-label',
      '@radix-ui/react-menubar',
      '@radix-ui/react-navigation-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-progress',
      '@radix-ui/react-radio-group',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-select',
      '@radix-ui/react-separator',
      '@radix-ui/react-slider',
      '@radix-ui/react-slot',
      '@radix-ui/react-switch',
      '@radix-ui/react-tabs',
      '@radix-ui/react-toast',
      '@radix-ui/react-toggle',
      '@radix-ui/react-toggle-group',
      '@radix-ui/react-tooltip',
    ]
  },
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    }),
    react(),
  ]
});