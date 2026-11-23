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

// Opens the installed Chrome with the unpacked extension loaded and Settings showing, for
// `npm run dev`. Dayboard's dev browser opens the same way.
// Chrome stopped honouring --load-extension in version 137, so the extension is loaded through the
// DevTools protocol, which Chrome allows when it starts with --enable-unsafe-extension-debugging.
// Chrome forgets an extension loaded that way when it closes, so it's loaded again on every launch.
// Its storage stays in the profile, which is kept under .vscode, so the filters you set up while
// developing survive a restart.
export async function openDevBrowser(extensionPath: string): Promise<DevBrowser> {
  const context = await chromium.launchPersistentContext(
    path.resolve('.vscode/chrome-debug-profile'),
    {
      channel: 'chrome',
      headless: false,
      // Let the page follow the window, as a browser opened by hand does, instead of a fixed 1280×720.
      viewport: null,
      // Playwright turns extensions off, which would leave the loaded one disabled, and adds the
      // "controlled by automated test software" bar.
      ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
      args: ['--enable-unsafe-extension-debugging'],
    }
  );

  const browser = context.browser();
  if (!browser) {
    throw new Error('Playwright gave no browser to load the extension through.');
  }
  const session = await browser.newBrowserCDPSession();
  const { id } = await session.send('Extensions.loadUnpacked', { path: extensionPath });
  const extensionOrigin = `chrome-extension://${id}`;

  const page = context.pages()[0] ?? (await context.newPage());
  // Chrome reloads an unpacked extension into a disabled state unless developer mode is on, and the
  // dev script reloads it whenever the service worker changes.
  await page.goto('chrome://extensions/');
  await page.evaluate(() =>
    (
      chrome as unknown as { developerPrivate: DeveloperPrivate }
    ).developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })
  );
  await page.goto(`${extensionOrigin}/options.html`);

  return { context, extensionOrigin };
}

// The extension's pages read its files from disk, so reloading them picks up a rebuild that left
// the service worker alone. Returns how many reloaded.
export async function reloadPages({ context, extensionOrigin }: DevBrowser): Promise<number> {
  const pages = context.pages().filter((page) => page.url().startsWith(`${extensionOrigin}/`));
  // A page closed mid-reload has nothing left to show.
  await Promise.all(pages.map((page) => page.reload().catch(() => {})));
  return pages.length;
}

// A running service worker keeps the code it started with, so when a rebuild changes it the whole
// extension reloads, which restarts the worker on the new files. Chrome closes the extension's tabs
// when it reloads, so the ones that were open are opened again. Returns how many.
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
