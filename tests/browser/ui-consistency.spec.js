import { test, expect } from '@playwright/test';
import { mockBackend, item } from './fixture.js';

const widths = [1440, 1366, 768, 390, 360];
const pages = ['items', 'inventory', 'purchases', 'sales', 'orders', 'preorders', 'login'];
const otherPages = [
  'index',
  'adjustments',
  'color-names',
  'item-groups',
  'image-preview',
  'import-batches',
  'import-batch-details',
  'import-v2',
  'import-printed',
  'purchases-review',
  'sales-review',
  'purchases-import-review',
  'sales-import-review',
  'operation-history',
  'account',
  'users',
  'reconciliation',
];
const isOpen = (menu) =>
  menu.evaluate((el) => el.matches(':popover-open') || el.hasAttribute('data-menu-open'));
async function ready(page, name) {
  await page.goto(`/${name}.html`);
  if (name === 'login') return expect(page.locator('#loginForm')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-auth-pending');
  await expect(page.locator('.site-header')).toBeVisible();
  if (name === 'items') await expect(page.locator('#itemsTbody tr')).toHaveCount(1);
  if (name === 'inventory') await expect(page.locator('.inventory-row')).toHaveCount(1);
  if (name === 'preorders') await expect(page.locator('.product-card')).toHaveCount(1);
}
async function noPageOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

for (const width of widths) {
  test(`remaining page controls stay inside the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockBackend(page);
    for (const name of otherPages) {
      await ready(page, name);
      await noPageOverflow(page);
      if (name.endsWith('-import-review')) {
        expect((await page.locator('#btnUpload').boundingBox()).height).toBeGreaterThanOrEqual(44);
        expect((await page.locator('#btnRecheck').boundingBox()).height).toBeGreaterThanOrEqual(42);
      }
      for (const select of await page.locator('select:visible').all()) {
        const box = await select.boundingBox();
        expect(box.height, `${name}: select height`).toBe(44);
        expect(box.x, `${name}: select start`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${name}: select end`).toBeLessThanOrEqual(width + 1);
      }
    }
  });
  test(`controls, items spacing and RTL layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockBackend(page);
    for (const name of pages) {
      await ready(page, name);
      await noPageOverflow(page);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      if (name === 'preorders') {
        await expect(page.locator('link[href*="controls.css"]')).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveClass(/ui-page/);
        continue;
      }
      const selects = page.locator('select:visible');
      for (const select of await selects.all()) {
        const box = await select.boundingBox();
        expect(box.height).toBe(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(await select.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(
          width <= 768 ? 16 : 14,
        );
      }
      if (name === 'items') {
        const filters = await page.locator('#quickFiltersBar').boundingBox();
        const list = await page.locator('.items-list').boundingBox();
        expect(Math.round(list.y - (filters.y + filters.height))).toBe(width <= 768 ? 12 : 16);
        for (const button of await page.locator('#quickFiltersBar button').all()) {
          expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(
            width <= 768 ? 44 : 40,
          );
        }
        await page.locator('#quickMainCategory').evaluate((el) => {
          el.options[0].textContent = 'نص طويل لاختبار القائمة المنسدلة '.repeat(8);
        });
        await noPageOverflow(page);
        await page.locator('#search').fill('غير موجود');
        await expect(page.locator('#itemsTbody tr')).toHaveCount(0);
        await page.locator('#search').fill('خامة');
        await expect(page.locator('#itemsTbody tr')).toHaveCount(1);
      }
      if (name === 'purchases' || name === 'sales') {
        const excel = await page.locator('.import-panel').boundingBox();
        const summary = await page.locator('.summary-panel').boundingBox();
        expect(excel.y + excel.height).toBeLessThanOrEqual(summary.y);
        expect(
          await page.locator('.summary-panel').evaluate((el) => getComputedStyle(el).position),
        ).toBe(width > 850 ? 'sticky' : 'static');
        expect(
          await page.locator('.import-panel').evaluate((el) => getComputedStyle(el).position),
        ).not.toBe('sticky');
        expect((await page.locator('#saveEntry').boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test(`inventory menu stays visible, accessible and inside viewport at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockBackend(page);
    await ready(page, 'inventory');
    const trigger = page.locator('[data-action-menu]');
    const menu = page.locator('.inventory-actions-menu');
    const visible = page.locator('.cell-actions button:visible');
    await expect(visible).toHaveCount(3);
    await expect(visible.nth(0)).toContainText('الطلبات');
    await expect(visible.nth(1)).toHaveText('حركة المادة');
    await expect(trigger).toHaveAttribute('aria-label', /إجراءات المادة/);
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
    expect(await isOpen(menu)).toBe(true);
    const bounds = await menu.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
    expect(
      await menu.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + 12));
      }),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.locator('[role="menuitem"]').first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.locator('[role="menuitem"]').last()).toBeFocused();
    await page.locator('h1').click();
    await expect(menu).toBeHidden();
    await trigger.click();
    await menu.getByRole('menuitem', { name: 'تسوية المادة', exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator('#adjustModal')).toBeVisible();
    await page.locator('#adjustClose').click();
    await page.locator('.cell-actions [data-act="view-orders"]').click();
    await expect(page.locator('#ordersModal')).toBeVisible();
    await page.locator('#ordersClose').click();
    await page.locator('.cell-actions [data-act="view-moves"]').click();
    await expect(page.locator('#movesModal')).toBeVisible();
  });
}

for (const name of ['purchases', 'sales']) {
  test(`${name} summary alone sticks within the sidebar and scrolls long content`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBackend(page);
    await ready(page, name);
    for (let n = 0; n < 9; n++) await page.locator('#addRow').click();
    // Adding a row focuses its input and may scroll to the end of the form.
    await page.evaluate(() => window.scrollTo(0, 0));
    const summary = page.locator('.summary-panel');
    const excelBefore = await page.locator('.import-panel').boundingBox();
    const initial = await summary.boundingBox();
    await page.evaluate((y) => window.scrollTo(0, y), initial.y + 50);
    await expect.poll(async () => Math.round((await summary.boundingBox()).y)).toBe(16);
    const excelAfter = await page.locator('.import-panel').boundingBox();
    expect(excelAfter.y).toBeLessThan(excelBefore.y - 100);
    expect(excelAfter.y + excelAfter.height).toBeLessThanOrEqual((await summary.boundingBox()).y);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const aside = await page.locator('.entry-layout > aside').boundingBox();
    const last = await summary.boundingBox();
    expect(last.y + last.height).toBeLessThanOrEqual(aside.y + aside.height + 1);
    await page.locator('#entrySummary').evaluate((el) => {
      for (let n = 0; n < 60; n++) {
        const row = document.createElement('p');
        row.textContent = 'سطر ملخص طويل للاختبار';
        el.append(row);
      }
    });
    await expect.poll(() => summary.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect((await summary.boundingBox()).height).toBeLessThanOrEqual(868);
    await summary.evaluate((el) => {
      el.scrollTop = 150;
    });
    expect(await summary.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.setViewportSize({ width: 390, height: 900 });
    await expect.poll(() => summary.evaluate((el) => getComputedStyle(el).position)).toBe('static');
    await noPageOverflow(page);
  });
}

test('inventory actions keep existing viewer and assistant visibility', async ({ page }) => {
  await mockBackend(page, { role: 'viewer' });
  await ready(page, 'inventory');
  await expect(page.locator('.cell-actions button:visible')).toHaveCount(2);
  await expect(page.locator('[data-action-menu]')).toHaveCount(0);
  await mockBackend(page, { role: 'assistant', permissions: { inventory: 'manage' } });
  await ready(page, 'inventory');
  await page.locator('[data-action-menu]').click();
  const menu = page.locator('.inventory-actions-menu');
  await expect(menu.locator('[data-act="edit-item"]')).toHaveCount(0);
  await expect(menu.locator('[data-act="toggle-item-status"]')).toHaveCount(0);
  await expect(menu.locator('[data-act="adjust-item"]')).toBeVisible();
  await expect(menu.locator('a')).toHaveCount(2);
});

for (const active of [true, false])
  test(`menu fallback preserves ${active ? 'deactivation' : 'activation'} confirmations`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      HTMLElement.prototype.showPopover = undefined;
    });
    await mockBackend(page, { materialRows: [{ ...item, is_active: active }] });
    await page.goto('/inventory.html');
    await expect(page.locator('.site-header')).toBeVisible();
    await page.locator('#scope').selectOption('all');
    const trigger = page.locator('[data-action-menu]');
    await trigger.click();
    const menu = page.locator('.inventory-actions-menu');
    expect(await menu.evaluate((el) => el.parentElement === document.body)).toBe(true);
    const confirm = page.waitForEvent('dialog');
    const click = menu
      .getByRole('menuitem', { name: active ? 'إيقاف المادة' : 'تفعيل المادة', exact: true })
      .click();
    const dialog = await confirm;
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain(active ? 'إيقاف' : 'تفعيل');
    await dialog.dismiss();
    await click;
    await expect(menu).toBeHidden();
    expect(await menu.evaluate((el) => el.closest('tbody') !== null)).toBe(true);
    await trigger.click();
    await page.locator('#search').fill('لا يوجد');
    await expect(page.locator('.inventory-row')).toHaveCount(0);
    await expect(page.locator('.inventory-actions-menu')).toHaveCount(0);
  });
