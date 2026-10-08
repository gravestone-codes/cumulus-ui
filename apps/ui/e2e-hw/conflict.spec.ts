/**
 * M1b on hardware: two users edit the same group interface field. Each sees
 * the other's presence; Alice applies first, Bob lands on the conflict screen,
 * rebases and applies. No locks, no data loss: Bob's value wins, Alice's apply
 * is audited. Run: HW_URL=… HW_USER=… HW_PASS=… HW_USER2=… HW_PASS2=… pnpm test:e2e:hw
 * (both users need apply rights and switch credentials on every member).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

const env = (k: string, d?: string) => process.env[k] ?? d ?? '';
const group = env('HW_GROUP', 'GG');
const iface = env('HW_IFACE', 'swp32');

test.skip(!process.env.HW_URL || !process.env.HW_USER2, 'HW_URL / HW_USER2 not set');

/** A signed-in page in its own browser context; returns it with the user's display name. */
async function signIn(browser: Browser, user: string, pass: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.locator('form input').nth(0).fill(user);
  await page.locator('form input').nth(1).fill(pass);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  const me = (await (await page.request.get('/api/v1/auth/me')).json()) as {
    user: { display_name: string };
  };
  return { page, name: me.user.display_name };
}

/** Open the General editor on the group interface (this heartbeats presence). */
async function openEditor(page: Page) {
  await page.goto(`/groups/${group}/interfaces/${iface}`);
  await page.getByRole('tab', { name: 'Config' }).click();
  await page
    .getByRole('navigation', { name: 'Config sections' })
    .getByRole('button', { name: 'General', exact: true })
    .click();
  await page.getByRole('button', { name: /^(Edit|Configure)$/ }).click();
}

/** Stage `value` and stop at the dry-run. */
async function stage(page: Page, value: string) {
  await page.getByRole('dialog').getByLabel('Description').fill(value);
  await page.getByRole('button', { name: 'Review change' }).click();
  await expect(page.getByText('Dry-run')).toBeVisible({ timeout: 60_000 });
}

/** Wait for the result list and assert every member reported done. */
async function expectAllDone(page: Page) {
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 180_000 });
  const results = await page.getByRole('dialog').innerText();
  const members = Number(/(\d+) switch/.exec(results)?.[1] ?? 1);
  expect(results.match(/✓ done/g)?.length).toBe(members);
  await page.getByRole('button', { name: 'Done' }).click();
}

test('two users, one field: presence, conflict, rebase, apply', async ({ browser }) => {
  const started = Date.now();
  const alice = await signIn(browser, env('HW_USER'), env('HW_PASS'));
  const bob = await signIn(browser, env('HW_USER2'), env('HW_PASS2'));
  const aliceValue = `e2e alice ${started}`;
  const bobValue = `e2e bob ${started}`;

  try {
    // 1. Presence: each sees the other (banner polls every 30s).
    await openEditor(alice.page);
    await openEditor(bob.page);
    await expect(bob.page.getByText(`${alice.name} is editing`)).toBeVisible({ timeout: 45_000 });
    await expect(alice.page.getByText(`${bob.name} is editing`)).toBeVisible({ timeout: 45_000 });

    // 2. Both stage the same field on their own branch.
    await stage(alice.page, aliceValue);
    await stage(bob.page, bobValue);

    // 3. Alice applies first.
    await alice.page.getByRole('button', { name: /^Apply/ }).click();
    await expectAllDone(alice.page);

    // 4. Bob's apply hits the overlap check: mine vs landed, attributed to Alice.
    await bob.page.getByRole('button', { name: /^Apply/ }).click();
    const dialog = bob.page.getByRole('dialog');
    await expect(dialog.getByText('changed since you staged')).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByText(bobValue)).toBeVisible();
    await expect(dialog.getByText(aliceValue)).toBeVisible();
    await expect(dialog.getByText(`by ${alice.name}`)).toBeVisible();

    // 5. Rebase and apply: Bob's value lands everywhere.
    await dialog.getByRole('button', { name: 'Rebase and apply' }).click();
    await expectAllDone(bob.page);
    await expect(bob.page.getByText(bobValue).first()).toBeVisible({ timeout: 30_000 });
    await expect(bob.page.getByText(aliceValue)).toHaveCount(0);

    // Alice's apply and Bob's failed attempt are both in the audit trail.
    const audit = (await (await alice.page.request.get('/api/v1/audit?limit=200')).json()) as Array<{
      ts: string;
      user_sub: string;
      path: string;
      after: { paths?: string[]; conflicts?: unknown[] } | null;
    }>;
    const applies = audit.filter((r) => r.path.endsWith('/apply') && Date.parse(r.ts) >= started - 5_000);
    const touched = (r: (typeof applies)[number]) => r.after?.paths?.some((p) => p.includes(iface));
    const aliceSub = env('HW_USER').toLowerCase();
    const bobSub = env('HW_USER2').toLowerCase();
    expect(applies.filter((r) => r.user_sub === aliceSub && touched(r)).length).toBeGreaterThan(0);
    expect(applies.filter((r) => r.user_sub === bobSub && r.after?.conflicts).length).toBeGreaterThan(0);
    expect(applies.filter((r) => r.user_sub === bobSub && touched(r)).length).toBeGreaterThan(0);
  } finally {
    // 6. Cleanup: clear the field (and any draft a failed run left behind).
    const switches = (await (await alice.page.request.get('/api/v1/inventory/switches')).json()) as Array<{
      id: string;
      groups: string[];
    }>;
    for (const sw of switches.filter((s) => s.groups.includes(group))) {
      for (const { page } of [alice, bob]) await page.request.delete(`/api/v1/switches/${sw.id}/branch`);
    }
    await openEditor(alice.page);
    const dialog = alice.page.getByRole('dialog');
    await dialog.getByLabel('Description').fill('');
    await dialog.getByRole('button', { name: 'Review change' }).click();
    const dryRun = alice.page.getByText('Dry-run');
    await expect(dryRun.or(dialog.getByText('No changes to stage.'))).toBeVisible({ timeout: 60_000 });
    if (await dryRun.isVisible()) {
      await alice.page.getByRole('button', { name: /^Apply/ }).click();
      await expectAllDone(alice.page);
    }
  }
});
