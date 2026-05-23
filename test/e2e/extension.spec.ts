import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  captureScreenshot,
  createStorageData,
  defaultGroup,
  mockAllowedPage,
  readStorage,
  seedStorage,
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

async function expectBlockedSameTabNavigation(page: Page, targetUrl: string): Promise<void> {
  await expect.poll(() => page.url()).toContain(`/${PAGES.BLOCKED}?url=`);
  await expect(page.getByRole('heading', { name: 'Page Blocked' })).toBeVisible();
  await expect(page.getByLabel('Blocked URL')).toHaveText(targetUrl);
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
  await expect(page.getByText('No filters configured.')).toBeVisible();
  await expect.poll(() => readStorage(page)).toBeUndefined();
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
  await page.goto(targetUrl).catch(() => undefined);

  await expect.poll(() => page.url()).toContain(`/${PAGES.BLOCKED}?url=`);
  await expect(page.getByRole('heading', { name: 'Page Blocked' })).toBeVisible();
  await expect(page.getByLabel('Blocked URL')).toHaveText(targetUrl);
});

test('shows warning interstitials with continue and scopes bypasses to the same tab and origin', async ({
  context,
  extensionPage,
  page,
}, testInfo) => {
  await page.goto(extensionPage(PAGES.OPTIONS));
  await seedStorage(
    page,
    createStorageData({
      blockType: 'warning',
      filters: [
        {
          id: 'warning-filter',
          pattern: 'warning.example.test',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          description: 'E2E Warning',
        },
        {
          id: 'hard-filter',
          pattern: 'warning.example.test/hard',
          groupId: defaultGroup.id,
          enabled: true,
          matchMode: 'contains',
          blockType: 'block',
          description: 'E2E Hard Block',
        },
      ],
    })
  );

  const firstTargetUrl = 'https://warning.example.test/focus';
  const sameOriginTargetUrl = 'https://warning.example.test/next';
  const hardBlockUrl = 'https://warning.example.test/hard';
  const newTabWarningUrl = 'https://warning.example.test/fresh';

  await mockAllowedPage(page, firstTargetUrl, 'Warning Continue Page');
  await mockAllowedPage(page, sameOriginTargetUrl, 'Warning Same Origin Page');
  await mockAllowedPage(page, hardBlockUrl, 'Warning Hard Block Page');

  await page.goto(firstTargetUrl).catch(() => undefined);
  await expect.poll(() => page.url()).toContain(`/${PAGES.BLOCKED}?url=`);
  await expect(page.getByRole('heading', { name: 'Warning' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await captureScreenshot(page, testInfo, 'warning-interstitial.png');

  await Promise.all([
    page.waitForURL(firstTargetUrl),
    page.getByRole('button', { name: 'Continue' }).click(),
  ]);
  await expect(page.getByText('Warning Continue Page')).toBeVisible();

  await page.goto(sameOriginTargetUrl).catch(() => undefined);
  await expect(page.getByText('Warning Same Origin Page')).toBeVisible();

  const secondPage = await context.newPage();
  await mockAllowedPage(secondPage, newTabWarningUrl, 'Second Tab Warning Page');
  await secondPage.goto(newTabWarningUrl).catch(() => undefined);
  await expect.poll(() => secondPage.url()).toContain(`/${PAGES.BLOCKED}?url=`);
  await expect(secondPage.getByRole('heading', { name: 'Warning' })).toBeVisible();
  await secondPage.close();

  await page.goto(hardBlockUrl).catch(() => undefined);
  await expect.poll(() => page.url()).toContain(`/${PAGES.BLOCKED}?url=`);
  await expect(page.getByRole('heading', { name: 'Page Blocked' })).toBeVisible();
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

    await expectBlockedSameTabNavigation(page, targetUrl);
    await captureScreenshot(page, testInfo, `${navigationMethod}-blocked-page.png`);

    await Promise.all([
      page.waitForURL(initialUrl),
      page.getByRole('button', { name: 'Go Back' }).click(),
    ]);
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

  await expectBlockedSameTabNavigation(page, targetUrl);
  await captureScreenshot(page, testInfo, 'hash-blocked-page.png');

  await Promise.all([
    page.waitForURL(initialUrl),
    page.getByRole('button', { name: 'Go Back' }).click(),
  ]);
  await expect(page.getByRole('heading', { name: 'SPA Route Test' })).toBeVisible();
  await expect(page.locator('#current-url')).toHaveText(initialUrl);
});
