import { defineConfig } from 'vite';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'client',
  plugins: [
    {
      // The Nintendo models are a local-only placeholder: never ship them in the build.
      name: 'strip-n64-models',
      apply: 'build',
      closeBundle() {
        rmSync(fileURLToPath(new URL('./dist/characters/n64', import.meta.url)), { recursive: true, force: true });
      },
    },
  ],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
