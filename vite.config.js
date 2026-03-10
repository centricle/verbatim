import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'public',
  plugins: [tailwindcss()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        about: resolve(__dirname, 'public/about.html'),
      },
    },
  },
  server: {
    port: 8033,
    strictPort: true,
    allowedHosts: true,
  },
});
