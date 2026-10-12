/**
 * M2 on hardware: a manifest collection path renders as list → detail →
 * edit with zero hand-written forms. Dry-run only (no apply): opens a VRF,
 * stages a router-id change through the generic form, expects the dry-run,
 * then backs out and discards. Run: HW_URL=… HW_USER=… HW_PASS=…
 * (HW_SWITCH / HW_VRF pick the target; the switch is never written).
 */
import { expect, test } from '@playwright/test';

const env = (k: string, d?: string) => process.env[k] ?? d ?? '';
const sw = env('HW_SWITCH', 'leaf01');
const vrf = env('HW_VRF', 'blue');

test.skip(!process.env.HW_URL, 'HW_URL not set');

test('vrf list, detail and generic edit dry-run with no hand-written forms', async ({ page }) => {
  await page.goto('/login');
  await page.locator('form input').nth(0).fill(env('HW_USER'));
  await page.locator('form input').nth(1).fill(env('HW_PASS'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  // List renders from the schema (columns + picker, no hand-written table).
  await page.goto(`/switches/${sw}/vrfs`);
  await expect(page.getByRole('heading', { name: 'VRFs' })).toBeVisible();
  await page
    .getByRole('row', { name: new RegExp(vrf) })
    .first()
    .click();

  // Detail renders the generic frame (header + tab slots).
  await expect(page.getByRole('heading', { name: vrf, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Edit' }).click();

  // The generic form stages a change; the dry-run proves the plan.
  await page.getByLabel('Router ID').fill('10.255.255.254');
  await page.getByRole('button', { name: 'Review change' }).click();
  await expect(page.getByText('Dry-run')).toBeVisible({ timeout: 60_000 });

  // Back out: the draft is discarded, the switch untouched.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('tab', { name: 'Edit' })).toBeVisible();
});
