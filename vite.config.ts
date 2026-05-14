import { resolve } from 'node:path';
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';
import manifest from './manifest.json';

const extensionManifest = manifest as ManifestV3Export;

export default defineConfig(({ mode }) => ({
  plugins: [crx({ manifest: extensionManifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    target: 'chrome88',
    rollupOptions: {
      input: {
        'blocked/index': resolve(import.meta.dirname, 'src/blocked/index.html'),
      },
    },
  },
  esbuild: mode === 'development' ? undefined : { drop: ['console'] },
}));
