import { test, expect } from './fixtures';
import { captureScreenshot } from './helpers';

test('go back restores the last allowed url', async ({
  context,
  extensionPage,
  page,
}, testInfo) => {
  const blockedUrl = 'https://blocked.example.invalid/focus';
  const allowedUrl = 'https://allowed.example.test/landing';

  await context.route(allowedUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Allowed</title><main>Allowed page</main>',
    });
  });

  await page.goto(`${extensionPage('blocked/index.html')}?url=${encodeURIComponent(blockedUrl)}`);
  await page.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id === 'number') {
      await chrome.storage.session.set({ [`last_allowed_url_${tab.id}`]: url });
    }
  }, allowedUrl);

  await expect(page.getByLabel('Blocked URL')).toHaveText(blockedUrl);
  await captureScreenshot(page, testInfo, 'blocked-page.png');

  await Promise.all([
    page.waitForURL(allowedUrl),
    page.getByRole('button', { name: 'Go Back' }).click(),
  ]);
  await expect(page.getByText('Allowed page')).toBeVisible();
});

test('opens settings from the blocked page', async ({ context, extensionPage, page }) => {
  await page.goto(
    `${extensionPage('blocked/index.html')}?url=${encodeURIComponent('https://blocked.example.invalid')}`
  );

  const optionsPagePromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Manage Filters' }).click();
  const optionsPage = await optionsPagePromise;
  await optionsPage.waitForLoadState();

  await expect(optionsPage.getByRole('heading', { name: 'Teichos' })).toBeVisible();
  await expect(optionsPage).toHaveURL(/options\/index\.html$/);
});
