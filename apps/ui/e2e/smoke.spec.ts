import { expect, test } from '@playwright/test';

test('landing renders product name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Cumulus' })).toBeVisible();
});
