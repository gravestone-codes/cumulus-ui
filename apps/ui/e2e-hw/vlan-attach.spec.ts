/**
 * 3B.2 on hardware: attach a free port to br_default as access on every
 * group member, see it from both sides (bridge Ports tab + interface Bridge
 * section, no mixed values), then detach it. Run like the other hardware
 * specs (HW_GROUP / HW_DOMAIN / HW_PORT / HW_VLAN).
 */
import { expect, test, type Page } from '@playwright/test';

const env = (k: string, d?: string) => process.env[k] ?? d ?? '';
const group = env('HW_GROUP', 'GG');
const domain = env('HW_DOMAIN', 'br_default');
const port = env('HW_PORT', 'swp32');
const vlan = env('HW_VLAN', '3001');

test.skip(!process.env.HW_URL, 'HW_URL not set');

/** (Discard leftovers →) dry-run → apply → every touched member done; closes the result. */
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
 * Set the domain's VLAN list through Config → VLANs → Edit, so the access
 * VLAN under test exists on the domain before the port joins it.
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
}

const portRow = (page: Page) => page.getByRole('row').filter({ hasText: port }).first();

/** Detach the port when a previous failed run left it attached. */
async function detachIfAttached(page: Page) {
  await page.getByRole('tab', { name: 'Ports' }).click();
  if ((await portRow(page).count()) === 0) return;
  await portRow(page).getByRole('button', { name: 'Row actions' }).click();
  await page.getByRole('menu').getByRole('button', { name: /^Detach/ }).click();
  await applyAll(page);
  await expect(portRow(page)).toHaveCount(0, { timeout: 30_000 });
}

test('port attaches as access on every member, reads from both sides, then detaches', async ({
  page,
}) => {
  await page.goto('/login');
  await page.locator('form input').nth(0).fill(env('HW_USER'));
  await page.locator('form input').nth(1).fill(env('HW_PASS'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  await page.goto(`/groups/${group}/bridge/${domain}`);
  await expect(page.getByRole('heading', { name: domain })).toBeVisible({ timeout: 30_000 });

  // The access VLAN must exist on the domain first.
  const withVlan = (list: string) =>
    list
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .concat([vlan])
      .filter((v, i, all) => all.indexOf(v) === i)
      .join(', ');
  await page.getByRole('tab', { name: 'VLANs' }).click();
  if ((await page.getByRole('row').filter({ hasText: vlan }).count()) === 0) {
    await setVlans(page, withVlan);
  }

  await detachIfAttached(page);

  await page.getByRole('button', { name: 'Add ports' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Search Ports').fill(port);
  await dialog
    .getByRole('listbox', { name: 'Ports' })
    .getByRole('option', { name: new RegExp(`^${port} `) })
    .click();
  await dialog.getByLabel('Access VLAN', { exact: true }).fill(vlan);
  await dialog.getByRole('button', { name: 'Review change' }).click();
  await applyAll(page);

  await page.getByRole('tab', { name: 'Ports' }).click();
  await expect(portRow(page)).toBeVisible({ timeout: 30_000 });
  await expect(portRow(page)).toContainText(vlan);
  await expect(portRow(page)).not.toContainText('mixed');

  // The interface side shows the same membership in its Bridge section.
  await page.goto(`/groups/${group}/interfaces/${port}`);
  await page.getByRole('tab', { name: 'Config' }).click();
  const bridge = page.getByText(domain, { exact: true });
  await expect(bridge).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(vlan, { exact: true }).first()).toBeVisible();

  // Detach from the bridge side; the round trip ends clean.
  await page.goto(`/groups/${group}/bridge/${domain}`);
  await expect(page.getByRole('heading', { name: domain })).toBeVisible({ timeout: 30_000 });
  await detachIfAttached(page);
});
