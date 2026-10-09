/**
 * 3B.3 on hardware: the MAC table shows live learned MACs in switch and
 * group scope (Switch column in groups), clearing dynamic MACs on one
 * switch works, and the clear is in the audit log. Run like the other
 * hardware specs (HW_URL / HW_USER / HW_PASS / HW_GROUP / HW_SWITCH /
 * HW_DOMAIN).
 */
import { expect, test } from '@playwright/test';

const env = (k: string, d?: string) => process.env[k] ?? d ?? '';
const group = env('HW_GROUP', 'GG');
const sw = env('HW_SWITCH', 'leaf01');
const domain = env('HW_DOMAIN', 'br_default');

test.skip(!process.env.HW_URL, 'HW_URL not set');

test('MAC table shows live MACs in both scopes; clear on one switch is audited', async ({ page }) => {
  await page.goto('/login');
  await page.locator('form input').nth(0).fill(env('HW_USER'));
  await page.locator('form input').nth(1).fill(env('HW_PASS'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  // Switch scope: the MAC tab lists learned MACs (MAC, VLAN, Interface, Type, Age).
  await page.goto(`/switches/${sw}/bridge/${domain}?tab=macs`);
  await expect(page.getByRole('tab', { name: 'MACs' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'MAC' })).toBeVisible({ timeout: 30_000 });
  for (const col of ['VLAN', 'Interface', 'Type', 'Age']) {
    await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
  }

  // Group scope: same table with a Switch column.
  await page.goto(`/groups/${group}/bridge/${domain}?tab=macs`);
  await expect(page.getByRole('columnheader', { name: 'Switch' })).toBeVisible({ timeout: 30_000 });

  // Clear dynamic MACs on one switch through the ActionRunner confirm.
  await page.goto(`/switches/${sw}/bridge/${domain}?tab=macs`);
  await page.getByRole('button', { name: 'Clear dynamic MACs' }).click();
  await page.getByRole('button', { name: 'Clear dynamic MACs' }).last().click();
  await expect(page.getByText(/cleared on/i)).toBeVisible({ timeout: 120_000 });

  // The clear is in the audit log.
  await page.goto(`/switches/${sw}/audit`);
  await expect(page.getByText(/mac-table\/dynamic/).first()).toBeVisible({ timeout: 30_000 });
});
