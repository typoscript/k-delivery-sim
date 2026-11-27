import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
  // Large JSON (the 1.5MB open-world map) is emitted as JSON.parse("...") which parses much faster than an object literal
  json: { stringify: true },
  test: {
    // The game downloads the legacy district maps on demand at startup; unit tests get them synchronously here
    setupFiles: ['./src/test/provideMapData.ts'],
  },
  build: {
    outDir: 'dist',
    // The game code chunk is ~460kB; only three.js (~520kB) and the map data chunk (~1.5MB, 200kB gzipped) are larger
    chunkSizeWarningLimit: 1600,
    sourcemap: false,
    rollupOptions: {
      // Game + standalone open-world chunk streaming preview
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        openworld: fileURLToPath(new URL('./openworld.html', import.meta.url)),
      },
      output: {
        // three.js and the 1.5MB open-world map in their own long-cached chunks: they download in parallel with
        // the game code, and a game code update does not re-download them
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/src/data/openworld/suwonWorld.json')) return 'map-suwon';
          return undefined;
        },
      },
    },
  },
});
