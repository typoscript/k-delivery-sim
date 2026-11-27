import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Relative base path ensures the build works on any GitHub Pages repository URL
export default defineConfig({
  base: './',
  server: {
    watch: {
      // Required on WSL (/mnt/c) so Vite detects file edits reliably
      usePolling: true,
      interval: 300,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      // Game + standalone open-world chunk streaming preview
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        openworld: fileURLToPath(new URL('./openworld.html', import.meta.url)),
      },
    },
  },
});
