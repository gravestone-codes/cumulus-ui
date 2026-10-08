/**
 * M1 on hardware: login → stage → dry-run → apply on a group interface, then
 * clear it back. Run: HW_URL=… HW_USER=… HW_PASS=… pnpm test:e2e:hw
 * (HW_GROUP / HW_IFACE pick the target; the interface ends as it started).
 */
import { expect, test, type Page } from '@playwright/test';

const env = (k: string, d?: string) => process.env[k] ?? d ?? '';
const group = env('HW_GROUP', 'GG');
const iface = env('HW_IFACE', 'swp32');

test.skip(!process.env.HW_URL, 'HW_URL not set');

async function setDescription(page: Page, value: string) {
  await page.goto(`/groups/${group}/interfaces/${iface}`);
  await page.getByRole('tab', { name: 'Config' }).click();
  await page
    .getByRole('navigation', { name: 'Config sections' })
    .getByRole('button', { name: 'General', exact: true })
    .click();
  await page.getByRole('button', { name: /^(Edit|Configure)$/ }).click();
  await page.getByRole('dialog').getByLabel('Description').fill(value);
  await page.getByRole('button', { name: 'Review change' }).click();
  await expect(page.getByText('Dry-run')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /Apply/ }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 180_000 });
  const results = await page.getByRole('dialog').innerText();
  await page.getByRole('button', { name: 'Done' }).click();
  return results;
}

/** Every member in the result list reported done. */
function allDone(results: string) {
  const members = Number(/(\d+) switch/.exec(results)?.[1] ?? 1);
  expect(results.match(/✓ done/g)?.length).toBe(members);
}

test('group interface edit applies to every member, then clears', async ({ page }) => {
  await page.goto('/login');
  await page.locator('form input').nth(0).fill(env('HW_USER'));
  await page.locator('form input').nth(1).fill(env('HW_PASS'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  const value = `e2e ${Date.now()}`;
  const applied = await setDescription(page, value);
  allDone(applied);
  await expect(page.getByText(value).first()).toBeVisible({ timeout: 30_000 });

  const cleared = await setDescription(page, '');
  allDone(cleared);
  await expect(page.getByText(value)).toHaveCount(0, { timeout: 30_000 });
});
