import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { chamberPages } from './scripts/chamber-pages.mjs';

export default defineConfig({
  root: 'public',
  envDir: resolve(__dirname),
  plugins: [
    tailwindcss(),
    react(),
    // public/disbursements/index.html is the source of /disbursements/house/
    // and /disbursements/senate/, not a page of its own (netlify.toml).
    chamberPages({
      template: resolve(__dirname, 'public/disbursements/index.html'),
      dir: 'disbursements',
      chambers: ['house', 'senate'],
    }),
  ],
  publicDir: resolve(__dirname, 'public/static'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        about: resolve(__dirname, 'public/about.html'),
        compas: resolve(__dirname, 'public/compas/index.html'),
        trades: resolve(__dirname, 'public/trades/index.html'),
        incidents: resolve(__dirname, 'public/incidents/index.html'),
        finance: resolve(__dirname, 'public/finance/index.html'),
        vs: resolve(__dirname, 'public/vs/index.html'),
        qi: resolve(__dirname, 'public/qi/index.html'),
        crashes: resolve(__dirname, 'public/crashes/index.html'),
        executive: resolve(__dirname, 'public/executive/index.html'),
        clemency: resolve(__dirname, 'public/clemency/index.html'),
        disbursements: resolve(__dirname, 'public/disbursements/index.html'),
        corpus: resolve(__dirname, 'public/corpus/index.html'),
        corpusContents: resolve(__dirname, 'public/corpus/contents/index.html'),
        amendments: resolve(__dirname, 'public/amendments/index.html'),
        'over-time': resolve(__dirname, 'public/over-time/index.html'),
      },
    },
  },
  server: {
    port: 8033,
    strictPort: true,
    allowedHosts: true,
  },
});
