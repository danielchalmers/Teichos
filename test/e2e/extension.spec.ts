import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  captureScreenshot,
  createStorageData,
  defaultGroup,
  expectBlocked,
  expectOnBlockedPage,
  readStorage,
  seedStorage,
  showBlockPageDetails,
  waitForOptionsReady,
} from './helpers';
import { PAGES } from '../../src/shared/constants';

async function mockSpaPage(page: Page, pattern: string): Promise<void> {
  await page.context().route(pattern, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html>
        <title>SPA Route Test</title>
        <main>
          <h1>SPA Route Test</h1>
          <p id="current-url"></p>
          <button id="push-state" type="button">Push blocked route</button>
          <button id="replace-state" type="button">Replace blocked route</button>
          <button id="set-hash" type="button">Set blocked hash</button>
        </main>
        <script>
          const currentUrl = document.getElementById('current-url');
          const render = () => {
            currentUrl.textContent = window.location.href;
          };
          document.getElementById('push-state').addEventListener('click', () => {
            history.pushState({}, '', '/blocked-route');
            render();
          });
          document.getElementById('replace-state').addEventListener('click', () => {
            history.replaceState({}, '', '/blocked-route');
            render();
          });
          document.getElementById('set-hash').addEventListener('click', () => {
            window.location.hash = 'blocked-hash';
            render();
          });
          window.addEventListener('popstate', render);
          window.addEventListener('hashchange', render);
          render();
        </script>`,
    });
  });
}

test('loads the extension service worker and extension pages', async ({
  extensionId,
  extensionPage,
  page,
}) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  await page.goto(extensionPage(PAGES.OPTIONS));
  await expect(page.getByRole('heading', { name: 'Teichos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Group' })).toBeVisible();

  await page.goto(extensionPage(PAGES.POPUP));
  await expect(page.getByRole('heading', { name: 'Teichos' })).toBeVisible();
  await expect(page.getByText('No filters yet')).toBeVisible();
  expect(await readStorage(page)).toBeUndefined();
});

test('names the extension in the toolbar button tooltip', async ({ extensionPage, page }) => {
  await page.goto(extensionPage(PAGES.POPUP));

  // The manifest sets the tooltip to the extension's name.
  const tooltip = await page.evaluate(() => chrome.action.getTitle({}));
  expect(tooltip).toBe('Teichos: Website Blocker');
  expect(tooltip).toBe(await page.evaluate(() => chrome.runtime.getManifest().name));
});

test('keeps the block page out of reach of websites', async ({ extensionPage, page }) => {
  const blockPageUrl = extensionPage(PAGES.BLOCKED);
  await page.goto('https://probe.example.test/');

  // A site that can load the block page knows Teichos is installed, and can frame the page.
  const fetched = await page.evaluate(
    (url) =>
      fetch(url).then(
        () => true,
        () => false
      ),
    blockPageUrl
  );
  await page.evaluate(async (url) => {
    const frame = document.createElement('iframe');
    frame.src = url;
    const loaded = new Promise((resolve) => frame.addEventListener('load', resolve));
    document.body.append(frame);
    await loaded;
  }, blockPageUrl);
  const framed = page.frames().some((frame) => frame.url() === blockPageUrl);

  expect({ fetched, framed }).toEqual({ fetched: false, framed: false });
});

/** The part of chrome://extensions' private API that switches "Allow in Incognito" on. */
interface DeveloperPrivate {
  updateProfileConfiguration(update: { inDeveloperMode: boolean }): Promise<void>;
  updateExtensionConfiguration(update: {
    extensionId: string;
    incognitoAccess: boolean;
  }): Promise<void>;
}

test('shows the block page in an Incognito window', async ({
  context,
  extensionId,
  extensionPage,
  page,
}) => {
  // Switch on "Allow in Incognito" the way the browser's own extensions page does. An unpacked
  // extension is disabled when it restarts for the change unless developer mode is on.
  await page.goto(`chrome://extensions/?id=${extensionId}`);
  await page.evaluate(async (id) => {
    const { developerPrivate } = chrome as unknown as { developerPrivate: DeveloperPrivate };
    await developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
    await developerPrivate.updateExtensionConfiguration({ extensionId: id, incognitoAccess: true });
  }, extensionId);
  await expect(async () => {
    await page.goto(extensionPage(PAGES.OPTIONS));
    await waitForOptionsReady(page);
    expect(await page.evaluate(() => chrome.extension.isAllowedIncognitoAccess())).toBe(true);
  }).toPass();

  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'incognito-filter',
          pattern: 'incognito.example.invalid',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'domain',
        },
      ],
    })
  );
  await page.evaluate(async (url) => {
    await chrome.windows.create({ url, incognito: true });
  }, 'https://incognito.example.invalid/focus');

  // The Incognito window is outside this browser context, so its tab is found through the
  // DevTools protocol. Only a block page that loaded has the block page's title: Chrome's error
  // page for an extension page it refused to open keeps the address but not the title.
  const devtools = await context.newCDPSession(page);
  await expect
    .poll(async () => {
      const { targetInfos } = await devtools.send('Target.getTargets');
      const ownContextId = targetInfos.find(
        (target) => target.url === extensionPage(PAGES.OPTIONS)
      )?.browserContextId;
      return targetInfos
        .filter((target) => target.type === 'page' && target.browserContextId !== ownContextId)
        .map((target) => target.title);
    })
    .toEqual(['incognito.example.invalid blocked · Teichos']);
});

test('redirects matching top-level navigations to the blocked page', async ({
  extensionPage,
  page,
}) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'e2e-filter',
          pattern: 'blocked.example.invalid',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'E2E Block',
        },
      ],
    })
  );

  const targetUrl = 'https://blocked.example.invalid/focus';
  await expectBlocked(page, targetUrl);
  await showBlockPageDetails(page);
  await expect(page.getByLabel('Responsible filter')).toContainText('E2E Block');
});

for (const navigationMethod of ['push-state', 'replace-state'] as const) {
  test(`blocks matching same-tab ${navigationMethod} navigations and preserves go back`, async ({
    extensionPage,
    page,
  }, testInfo) => {
    await mockSpaPage(page, 'https://spa.example.test/**');

    await page.goto(extensionPage(PAGES.OPTIONS));
    await seedStorage(
      page,
      createStorageData({
        filters: [
          {
            id: 'spa-filter',
            pattern: 'spa.example.test/blocked-route',
            groupId: defaultGroup.id,
            enabled: true,
            matchMode: 'contains',
            description: 'SPA Block',
          },
        ],
      })
    );

    const initialUrl = 'https://spa.example.test/start';
    const targetUrl = 'https://spa.example.test/blocked-route';

    await page.goto(initialUrl);
    await expect(page.getByRole('heading', { name: 'SPA Route Test' })).toBeVisible();

    await page.locator(`#${navigationMethod}`).click();

    await expectOnBlockedPage(page, targetUrl);
    await captureScreenshot(page, testInfo, `${navigationMethod}-blocked-page.png`);

    await showBlockPageDetails(page);
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect.poll(() => page.url(), { timeout: 15_000 }).toBe(initialUrl);
    await expect(page.getByRole('heading', { name: 'SPA Route Test' })).toBeVisible();
    await expect(page.locator('#current-url')).toHaveText(initialUrl);
  });
}

test('blocks matching same-tab hash navigations and preserves go back', async ({
  extensionPage,
  page,
}, testInfo) => {
  await mockSpaPage(page, 'https://hash.example.test/**');

  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      filters: [
        {
          id: 'hash-filter',
          pattern: '#blocked-hash',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'Hash Block',
        },
      ],
    })
  );

  const initialUrl = 'https://hash.example.test/page';
  const targetUrl = 'https://hash.example.test/page#blocked-hash';

  await page.goto(initialUrl);
  await expect(page.getByRole('heading', { name: 'SPA Route Test' })).toBeVisible();

  await page.locator('#set-hash').click();

  await expectOnBlockedPage(page, targetUrl);
  await captureScreenshot(page, testInfo, 'hash-blocked-page.png');

  await showBlockPageDetails(page);
  await page.getByRole('button', { name: 'Go back' }).click();
  await expect.poll(() => page.url(), { timeout: 15_000 }).toBe(initialUrl);
  await expect(page.getByRole('heading', { name: 'SPA Route Test' })).toBeVisible();
  await expect(page.locator('#current-url')).toHaveText(initialUrl);
});
