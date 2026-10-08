/**
 * 3B.1 on hardware: the bridge domain shows in switch and group scope, and a
 * VLAN added to it applies on every member, then comes off again. Run like
 * the other hardware specs (HW_GROUP / HW_SWITCH / HW_DOMAIN / HW_VLAN —
 * outside the reserved 3725–3999 range).
 */
import { expect, test, type Page } from '@playwright/test';

const env = (k: string, d?: string) => process.env[k] ?? d ?? '';
const group = env('HW_GROUP', 'GG');
const sw = env('HW_SWITCH', 'leaf01');
const domain = env('HW_DOMAIN', 'br_default');
const vlan = env('HW_VLAN', '3001');

test.skip(!process.env.HW_URL, 'HW_URL not set');

/** (Discard leftovers →) dry-run → apply → every member done; closes the result. */
async function applyAll(page: Page) {
  // A failed earlier run leaves its draft staged; discarding it is the designed way out.
  const discard = page.getByRole('button', { name: 'Discard and stage mine' });
  await expect(page.getByText('Dry-run').or(discard)).toBeVisible({ timeout: 60_000 });
  if (await discard.isVisible()) await discard.click();
  await expect(page.getByText('Dry-run')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /Apply/ }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 180_000 });
  const results = await page.getByRole('dialog').innerText();
  const members = Number(/(\d+) switch/.exec(results)?.[1] ?? 1);
  expect(results.match(/✓ done/g)?.length).toBe(members);
  await page.getByRole('button', { name: 'Done' }).click();
}

/**
 * Set the domain's VLAN list through Config → VLANs → Edit; the card must
 * then read exactly that list (kept VLANs — even NVUE's default 1 — survive).
 */
async function setVlans(page: Page, vlans: (current: string) => string) {
  await page.getByRole('tab', { name: 'Config' }).click();
  await page
    .getByRole('navigation', { name: 'Config sections' })
    .getByRole('button', { name: 'VLANs', exact: true })
    .click();
  await page.getByRole('button', { name: /^(Edit|Configure)$/ }).click();
  const field = page.getByRole('dialog').getByLabel('VLANs', { exact: true });
  const target = vlans(await field.inputValue());
  await field.fill(target);
  await page.getByRole('button', { name: 'Review change' }).click();
  await applyAll(page);
  const expected = target
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b))
    .join(', ');
  await expect(page.getByRole('definition').first()).toHaveText(expected || '—', { timeout: 30_000 });
}

const vlanRow = (page: Page) => page.getByRole('row').filter({ hasText: vlan });

test('bridge domain shows in both scopes; a VLAN applies on every member, then clears', async ({ page }) => {
  await page.goto('/login');
  await page.locator('form input').nth(0).fill(env('HW_USER'));
  await page.locator('form input').nth(1).fill(env('HW_PASS'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  await page.goto(`/switches/${sw}/bridge`);
  await expect(page.getByRole('row').filter({ hasText: domain })).toBeVisible({ timeout: 30_000 });

  await page.goto(`/groups/${group}/bridge`);
  const row = page.getByRole('row').filter({ hasText: domain }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByRole('heading', { name: domain })).toBeVisible();

  const without = (list: string) =>
    list
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v && v !== vlan)
      .join(', ');
  // A previous failed run may have left the VLAN behind.
  await page.getByRole('tab', { name: 'VLANs' }).click();
  if ((await vlanRow(page).count()) > 0) await setVlans(page, without);

  await setVlans(page, (list) => [without(list), vlan].filter(Boolean).join(', '));
  await page.getByRole('tab', { name: 'VLANs' }).click();
  await expect(vlanRow(page)).toBeVisible({ timeout: 30_000 });
  await expect(vlanRow(page)).not.toContainText('mixed');

  await setVlans(page, without);
  await page.getByRole('tab', { name: 'VLANs' }).click();
  await expect(vlanRow(page)).toHaveCount(0, { timeout: 30_000 });
});
