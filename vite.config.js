import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: 'public',
  envDir: resolve(__dirname),
  plugins: [tailwindcss(), react()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        about: resolve(__dirname, 'public/about.html'),
        compas: resolve(__dirname, 'public/compas/index.html'),
        trades: resolve(__dirname, 'public/trades/index.html'),
        leso: resolve(__dirname, 'public/1033/index.html'),
      },
    },
  },
  server: {
    port: 8033,
    strictPort: true,
    allowedHosts: true,
  },
});
