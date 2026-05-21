import { test, expect } from './fixtures';
import { createStorageData, defaultGroup, seedStorage } from './helpers';
import { PAGES } from '../../src/shared/constants';

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
