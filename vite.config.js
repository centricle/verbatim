import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: 'public',
  envDir: resolve(__dirname),
  plugins: [tailwindcss(), react()],
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
        corpus: resolve(__dirname, 'public/corpus/index.html'),
        amendments: resolve(__dirname, 'public/amendments/index.html'),
      },
    },
  },
  server: {
    port: 8033,
    strictPort: true,
    allowedHosts: true,
  },
});
