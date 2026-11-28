import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const entrypoints = resolve(import.meta.dirname, 'src/entrypoints');

const name = 'Teichos: Website Blocker';

// The whole manifest: the build adds nothing to it.
const manifest = {
  manifest_version: 3,
  name,
  description:
    'Block distracting websites all day or on a schedule. Exceptions, snooze, and temporary blocks. No account, no tracking.',
  version: process.env['RELEASE_VERSION'] ?? '0.0.0',
  icons: {
    16: 'assets/icons/icon16.png',
    32: 'assets/icons/icon32.png',
    48: 'assets/icons/icon48.png',
    128: 'assets/icons/icon128.png',
  },
  // Never add declarativeNetRequest back. 1.0.0 used its `block` rules to stop a blocked page's
  // request before it was sent (#187), and Chrome showed its own "blocked by an extension" error
  // page before every block page. Without host permissions, `block` is the only rule that stops a
  // page, and Chrome always shows that error page for it. Adding any permission also disables
  // Teichos for every user until they accept it, so permissions are not tried out and dropped.
  permissions: ['alarms', 'storage', 'tabs', 'webNavigation'],
  // Incognito windows get their own instance of the extension, so a blocked site there can be
  // sent to the block page: with the default (spanning) mode the single instance lives in the
  // regular profile, and Chrome refuses to open its pages in an incognito tab.
  incognito: 'split',
  // The toolbar button's tooltip is the full name.
  action: { default_title: name, default_popup: 'popup.html' },
  options_ui: { open_in_tab: true, page: 'options.html' },
  background: { type: 'module', service_worker: 'background.js' },
} satisfies chrome.runtime.ManifestV3;

/** Writes manifest.json and moves each page to the name it uses: popup/index.html -> popup.html. */
function extensionManifest(): Plugin {
  return {
    name: 'teichos:extension-manifest',
    enforce: 'post',
    generateBundle(_options, bundle): void {
      for (const file of Object.values(bundle)) {
        file.fileName = file.fileName.replace(/\/index\.html$/, '.html');
      }
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest) });
    },
  };
}

export default defineConfig({
  root: entrypoints,
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, '.output/chrome-mv3'),
    emptyOutDir: true,
    // Chrome supports modulepreload natively, and the polyfill reads `document`, which would
    // crash the service worker if it ever landed in a chunk the background imports.
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: {
        background: resolve(entrypoints, 'background.ts'),
        blocked: resolve(entrypoints, 'blocked/index.html'),
        options: resolve(entrypoints, 'options/index.html'),
        popup: resolve(entrypoints, 'popup/index.html'),
      },
      output: {
        // The manifest names background.js, so it can't carry a hash.
        entryFileNames: (chunk): string =>
          chunk.name === 'background' ? 'background.js' : 'chunks/[name]-[hash].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
  plugins: [extensionManifest()],
});
