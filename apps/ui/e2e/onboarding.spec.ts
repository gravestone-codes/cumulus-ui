/**
 * Onboarding e2e: fresh DB → setup wizard → dashboard → dev reset → setup again.
 * Needs the API running (CI boots it with the preview webServer below).
 */
import { expect, test } from '@playwright/test';

test('first boot setup, login loop, dev reset', async ({ page }) => {
  // Fresh state regardless of prior runs.
  await page.goto('/login');
  await page.getByRole('button', { name: 'Reset (dev only)' }).click();
  await page.getByPlaceholder('RESET').fill('RESET');
  await page.getByRole('button', { name: 'Wipe everything' }).click();

  // Setup wizard (2 questions per step).
  await page.waitForURL('/setup');
  await page.getByPlaceholder('boss', { exact: true }).fill('e2e-boss');
  await page.getByPlaceholder('Boss', { exact: true }).fill('E2E Boss');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[type="password"]').first().fill('e2e-password-123');
  await page.locator('input[type="password"]').nth(1).fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create admin' }).click();
  await page.waitForURL('/dashboard');
  await expect(page.getByText('Signed in as E2E Boss')).toBeVisible();

  // Sign out → login form → back in with password.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('/login');
  await page.getByPlaceholder('boss').fill('e2e-boss');
  await page.locator('input[type="password"]').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/dashboard');

  // Landing gate routes an initialized system to login, never setup.
  await page.goto('/');
  await page.waitForURL('/login');
});
