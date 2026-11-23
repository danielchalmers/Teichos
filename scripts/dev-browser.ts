import path from 'node:path';

import { chromium, type BrowserContext, type Page } from '@playwright/test';

export interface DevBrowser {
  context: BrowserContext;
  /** chrome-extension://<id>, for opening the extension's pages by URL. */
  extensionOrigin: string;
}

// chrome://extensions has the private API behind its developer mode switch, which @types/chrome
// doesn't describe.
interface DeveloperPrivate {
  updateProfileConfiguration(update: { inDeveloperMode: boolean }): Promise<void>;
}

// Opens Chromium with the unpacked extension loaded and Settings showing, for `npm run dev`.
// It launches through Playwright, as test/e2e/fixtures.ts does, because Chrome stopped honouring
// --load-extension in version 137, and Playwright's own Chromium still loads it that way. Dayboard's
// dev browser opens the same way.
// The profile is kept under .vscode, so the filters you set up while developing survive a restart.
export async function openDevBrowser(extensionPath: string): Promise<DevBrowser> {
  const context = await chromium.launchPersistentContext(
    path.resolve('.vscode/chrome-debug-profile'),
    {
      channel: 'chromium',
      headless: false,
      // Let the page follow the window, as a browser opened by hand does, instead of a fixed 1280×720.
      viewport: null,
      // Leaves out the "controlled by automated test software" bar.
      ignoreDefaultArgs: ['--enable-automation'],
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    }
  );

  // The service worker starting is the sign that the extension has loaded.
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // URL.origin is "null" for schemes Node doesn't know, chrome-extension: among them.
  const { protocol, host } = new URL(worker.url());
  const extensionOrigin = `${protocol}//${host}`;

  const page = context.pages()[0] ?? (await context.newPage());
  // Chromium reloads an unpacked extension into a disabled state unless developer mode is on, and
  // the dev script reloads it after every rebuild.
  await page.goto('chrome://extensions/');
  await page.evaluate(() =>
    (
      chrome as unknown as { developerPrivate: DeveloperPrivate }
    ).developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })
  );
  await page.goto(`${extensionOrigin}/options.html`);

  return { context, extensionOrigin };
}

// Teichos's service worker does the blocking, so reloading its pages isn't enough after a rebuild:
// the whole extension reloads, which restarts the worker on the new files. Chrome closes the
// extension's tabs when it reloads, so the ones that were open are opened again. Returns how many.
export async function reloadExtension({ context, extensionOrigin }: DevBrowser): Promise<number> {
  const isExtension = (url: string): boolean => url.startsWith(`${extensionOrigin}/`);
  const openUrls = context
    .pages()
    .map((page) => page.url())
    .filter(isExtension);
  const restarted = context.waitForEvent('serviceworker', {
    predicate: (worker) => isExtension(worker.url()),
  });

  // Any of the extension's own contexts can reload it. Chrome keeps the worker awake while
  // Playwright is attached, but a page of the extension does the same job if it isn't there.
  const worker = context.serviceWorkers().find((candidate) => isExtension(candidate.url()));
  if (worker) {
    await worker.evaluate(() => chrome.runtime.reload());
  } else {
    const page = await openPage(context, `${extensionOrigin}/options.html`);
    await page.evaluate(() => chrome.runtime.reload());
  }
  await restarted;

  for (const url of openUrls) {
    await openPage(context, url);
  }
  return openUrls.length;
}

async function openPage(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  return page;
}
