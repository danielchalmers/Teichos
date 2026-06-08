import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

const chromiumProfile = resolve('.wxt/chrome-data');
mkdirSync(chromiumProfile, { recursive: true });

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Teichos: Page Blocker',
    version: process.env['RELEASE_VERSION'] ?? '0.0.0',
    description: 'Block URLs based on configurable regex filters with time-based scheduling',
    permissions: ['alarms', 'storage', 'tabs', 'webNavigation'],
    action: {
      default_title: 'Teichos: Page Blocker',
    },
    options_ui: {
      open_in_tab: true,
    },
    web_accessible_resources: [
      {
        matches: ['<all_urls>'],
        resources: ['blocked.html'],
      },
    ],
    icons: {
      16: 'assets/icons/icon16.png',
      32: 'assets/icons/icon32.png',
      48: 'assets/icons/icon48.png',
      128: 'assets/icons/icon128.png',
    },
  },
  vite: (env) => ({
    esbuild: env.mode === 'development' ? undefined : { drop: ['console'] },
    optimizeDeps: {
      entries: ['src/entrypoints/**/*.html'],
    },
  }),
  webExt: {
    chromiumProfile,
    keepProfileChanges: true,
    chromiumArgs: ['--disable-features=DisableLoadExtensionCommandLineSwitch'],
  },
});
