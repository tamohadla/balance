import { test, expect } from '@playwright/test';
import { mockBackend } from './fixture.js';

for (const width of [390, 1440]) {
  test(`login is usable at ${width}px and protects direct page access`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockBackend(page, { signedIn: false });
    await page.goto('/inventory.html');
    await expect(page).toHaveURL(/login\.html/);
    await expect(page.locator('#loginForm')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
for (const name of [
  'index',
  'inventory',
  'items',
  'orders',
  'preorders',
  'purchases',
  'sales',
  'purchases-review',
  'sales-review',
  'reconciliation',
  'adjustments',
  'item-groups',
  'color-names',
  'import-v2',
  'import-printed',
  'import-batches',
  'operation-history',
  'account',
  'users',
]) {
  test(`${name} initializes without JavaScript errors`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await mockBackend(page);
    await page.goto(`/${name}.html`);
    await expect(page.locator('html')).not.toHaveAttribute('data-auth-pending');
    await expect(page.locator('.site-header')).toBeVisible();
    await expect(page.locator('body')).not.toHaveText('');
    if (name === 'items') await expect(page.locator('#itemsTbody tr')).toHaveCount(1);
    if (name === 'inventory') await expect(page.locator('#tbody tr')).toHaveCount(1);
    if (name === 'preorders')
      await expect(page.locator('#productGrid .product-card')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}
test('import preview treats file contents as text and never executes markup', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/items.html');
  await page.locator('#btnBulk').click();
  await page
    .locator('#bulkText')
    .fill('group|sub|name|code|color|kg|<img src=x onerror="window.__importExecuted=true">');
  await page.locator('#bulkPreview').click();
  await expect(page.locator('#bulkTbody')).toContainText('<img src=x');
  await expect(page.locator('#bulkTbody img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__importExecuted)).toBeUndefined();
});
test('all Excel pages load the same reviewed local library', async ({ page }) => {
  await mockBackend(page);
  for (const name of [
    'items',
    'purchases',
    'sales',
    'purchases-import-review',
    'sales-import-review',
  ]) {
    await page.goto(`/${name}.html`);
    await expect.poll(() => page.evaluate(() => globalThis.XLSX?.version)).toBe('0.20.3');
    const roundTrip = await page.evaluate(() => {
      const sheet = XLSX.utils.aoa_to_sheet([
        ['اسم', 'عدد'],
        ['اختبار', 0],
      ]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
      const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
      const read = XLSX.read(bytes, { type: 'array' });
      return XLSX.utils.sheet_to_json(read.Sheets.Sheet1, { header: 1 });
    });
    expect(roundTrip).toEqual([
      ['اسم', 'عدد'],
      ['اختبار', 0],
    ]);
  }
});
