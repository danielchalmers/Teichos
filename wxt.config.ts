import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

const chromiumProfile = resolve('.wxt/chrome-data');
mkdirSync(chromiumProfile, { recursive: true });

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Teichos: Website Blocker',
    version: process.env['RELEASE_VERSION'] ?? '0.0.0',
    description:
      'Block distracting websites all day or on a schedule. Exceptions, snooze, and temporary blocks. No account, no tracking.',
    permissions: ['alarms', 'storage', 'tabs', 'webNavigation'],
    // Incognito windows get their own instance of the extension, so a blocked site there can be
    // sent to the block page: with the default (spanning) mode the single instance lives in the
    // regular profile, and Chrome refuses to open its pages in an incognito tab.
    incognito: 'split',
    action: {
      default_title: 'Teichos: Website Blocker',
    },
    options_ui: {
      open_in_tab: true,
    },
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
