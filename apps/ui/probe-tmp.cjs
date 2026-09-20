const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (msg) => console.log('CONSOLE', msg.type(), msg.text().slice(0, 300)));
  page.on('pageerror', (err) => console.log('PAGEERROR', String(err).slice(0, 500)));
  page.on('requestfailed', (r) => console.log('REQFAIL', r.url().slice(0, 120), r.failure()?.errorText));
  await page.goto('http://10.98.252.26:3000/', { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => console.log('GOTO:', e.message.slice(0, 200)));
  await page.waitForTimeout(4000);
  console.log('ROOT INNER:', (await page.$eval('#root', (el) => el.innerHTML)).slice(0, 300));
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
