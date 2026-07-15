import { expect, test } from '@playwright/test';

test('serves the SPA shell through the real apps/server', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Shipwright')).toBeVisible();
});

test('theme toggle switches and persists across reload', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  const initial = await html.getAttribute('data-theme');

  await page.getByRole('button', { name: /switch to/i }).click();
  await expect(html).not.toHaveAttribute('data-theme', initial ?? '');

  const toggled = await html.getAttribute('data-theme');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', toggled ?? '');
});

test('"?" opens the keyboard shortcuts overlay, Escape closes it', async ({ page }) => {
  await page.goto('/');
  const overlay = page.getByTestId('shortcuts-overlay');
  await expect(overlay).toBeHidden();

  await page.keyboard.press('?');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText('Keyboard shortcuts')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
});

test('prefers-reduced-motion is reflected on the document element', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
});

test('SC-08: an evil Host header is refused with 403 even for the SPA shell', async ({
  request,
  baseURL,
}) => {
  const res = await request.get(`${baseURL}/`, {
    headers: { host: 'evil.example.com:4402' },
  });
  expect(res.status()).toBe(403);
});
