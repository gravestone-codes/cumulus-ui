import { expect, test } from '@playwright/test';

test('login renders', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to Cumulus Junction' })).toBeVisible();
});
