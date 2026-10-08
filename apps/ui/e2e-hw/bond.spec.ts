/**
 * 3A.6 on hardware: create a group bond by picking its members in the
 * InterfacePicker, apply on every member, then delete it. Run like the other
 * hardware specs (HW_GROUP picks the group; HW_BOND_PORTS two free ports).
 */
import { expect, test, type Page } from '@playwright/test';

const env = (k: string, d?: string) => process.env[k] ?? d ?? '';
const group = env('HW_GROUP', 'GG');
const ports = env('HW_BOND_PORTS', 'swp30,swp31').split(',');
const bond = env('HW_BOND', 'bond9');

test.skip(!process.env.HW_URL, 'HW_URL not set');

/** Dry-run → apply → every member done; closes the result. */
async function applyAll(page: Page) {
  await expect(page.getByText('Dry-run')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /Apply/ }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 180_000 });
  const echo = await page.getByText(/applied on \d+ of \d+/).innerText();
  const [, done, of] = /applied on (\d+) of (\d+)/.exec(echo) ?? [];
  expect(done).toBe(of);
  await page.getByRole('button', { name: 'Done' }).click();
}

/** Delete the bond on every member that has it, via the row menu. */
async function deleteBond(page: Page) {
  const row = page.getByRole('row').filter({ hasText: bond }).first();
  await row.getByRole('button', { name: 'Row actions' }).click();
  await page
    .getByRole('menu')
    .getByRole('button', { name: /^Delete on/ })
    .click();
  await applyAll(page);
  await expect(page.getByRole('row').filter({ hasText: bond })).toHaveCount(0, { timeout: 30_000 });
}

test('bond with picked members is created on every member, then deleted', async ({ page }) => {
  await page.goto('/login');
  await page.locator('form input').nth(0).fill(env('HW_USER'));
  await page.locator('form input').nth(1).fill(env('HW_PASS'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  await page.goto(`/groups/${group}/interfaces`);
  await expect(page.getByRole('row').nth(1)).toBeVisible({ timeout: 30_000 });
  // A previous failed run may have left the bond behind.
  if ((await page.getByRole('row').filter({ hasText: bond }).count()) > 0) await deleteBond(page);
  await page.getByRole('button', { name: 'New interface' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(bond);
  const picker = dialog.getByRole('listbox', { name: 'Member ports' });
  for (const port of ports) {
    await dialog.getByLabel('Search Member ports').fill(port);
    await picker.getByRole('option', { name: new RegExp(`^${port} `) }).click();
  }
  for (const port of ports)
    await expect(dialog.getByRole('button', { name: `Remove ${port}` })).toBeVisible();
  await dialog.getByRole('button', { name: 'Review change' }).click();
  await applyAll(page);

  const row = page.getByRole('row').filter({ hasText: bond });
  await expect(row.first()).toBeVisible({ timeout: 30_000 });
  await expect(row.first()).toContainText('bond');
  // Its members are now taken: the picker no longer offers them.
  await page.getByRole('button', { name: 'New interface' }).click();
  await dialog.getByLabel('Search Member ports').fill(ports[0] ?? '');
  await expect(picker.getByRole('option')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await deleteBond(page);
});
