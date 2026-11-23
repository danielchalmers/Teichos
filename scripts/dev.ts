import { relative, resolve } from 'node:path';

import { build } from 'vite';

import { openDevBrowser, reloadExtension, type DevBrowser } from './dev-browser.ts';

// `npm run dev`: build the extension in watch mode, open Chromium with it loaded, and reload it after
// every rebuild. Dayboard's dev script works the same way.
// It builds into a folder of its own, so a production build (and e2e, which makes one) never swaps
// files out from under the open browser.
const outDir = resolve('.output/chrome-mv3-dev');

const result = await build({
  mode: 'development',
  build: { outDir, watch: {}, minify: false, sourcemap: true },
});

if (!('on' in result)) {
  throw new Error('Vite built once instead of watching.');
}

const watcher = result;

let browser: DevBrowser | undefined;
let opened = false;
// Rebuilds can finish back to back, so each reload waits for the one before it.
let reloading = Promise.resolve();

watcher.on('event', (event) => {
  if (event.code !== 'END') {
    return;
  }

  if (!opened) {
    opened = true;
    void open();
    return;
  }

  const current = browser;
  if (current) {
    reloading = reloading.then(() => reload(current));
  }
});

async function open(): Promise<void> {
  try {
    browser = await openDevBrowser(outDir);
    console.log('Opened browser');
    // Closing the browser ends the dev session, as stopping the script closes the browser.
    browser.context.on('close', () => void watcher.close());
  } catch (error) {
    // Keep rebuilding when the browser can't start (say, Playwright's Chromium isn't installed yet),
    // so the folder can still be loaded by hand.
    console.warn(error instanceof Error ? error.message : error);
    console.info(`Load "${relative(process.cwd(), outDir)}" as an unpacked extension manually.`);
  }
}

async function reload(current: DevBrowser): Promise<void> {
  try {
    const tabs = await reloadExtension(current);
    console.log(`Reloaded the extension${tabs > 0 ? ` and reopened ${tabs} tab(s)` : ''}`);
  } catch (error) {
    console.warn('Could not reload the extension:', error instanceof Error ? error.message : error);
  }
}
