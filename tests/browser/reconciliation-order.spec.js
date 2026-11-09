import { test, expect } from '@playwright/test';
import { mockBackend, item } from './fixture.js';

test('reconciliation matches material and default inventory order without losing entered counts', async ({
  page,
}) => {
  const material = (number, main, sub, name, color) => ({
    ...item,
    id: `${String(number).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    main_category: main,
    sub_category: sub,
    item_name: name,
    color_code: color,
  });
  // Deliberately shuffled at every level, independently of the sorting code.
  const materials = [
    material(1, 'مطبوع', 'قطن', 'باء', '02'),
    material(2, 'أقمشة', 'قطن', 'باء', '02'),
    material(3, 'أقمشة', 'بوكلية', 'ألف', '02'),
    material(4, 'أقمشة', 'قطن', 'ألف', '02'),
    material(5, 'أقمشة', 'قطن', 'ألف', '01'),
    material(6, 'أقمشة', 'قطن', 'باء', '01'),
  ];
  const expected = [3, 5, 4, 6, 2, 1].map((number) => materials[number - 1].id);
  await mockBackend(page, { materialRows: materials });

  await page.goto('/items.html');
  await expect(page.locator('#itemsTbody tr')).toHaveCount(6);
  expect(
    await page
      .locator('#itemsTbody [data-act="edit"]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.id)),
  ).toEqual(expected);

  await page.goto('/inventory.html');
  await expect(page.locator('#tbody tr')).toHaveCount(6);
  await page.locator('#preset').selectOption('default');
  expect(
    await page
      .locator('#tbody [data-act="view-moves"]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.id)),
  ).toEqual(expected);

  await page.goto('/reconciliation.html');
  const rows = page.locator('#tbody tr');
  const ids = () => rows.evaluateAll((nodes) => nodes.map((node) => node.dataset.id));
  await expect(rows).toHaveCount(6);
  expect(await ids()).toEqual(expected);

  const entered = page.locator(`tr[data-id="${expected[1]}"]`);
  await entered.locator('.aMain').fill('7.25');
  await entered.locator('.aRolls').fill('3');
  await page.locator('#reconSearch').fill('باء');
  expect(await ids()).toEqual([expected[3], expected[4], expected[5]]);
  await page.locator('#clearReconFilters').click();
  expect(await ids()).toEqual(expected);
  await expect(entered.locator('.aMain')).toHaveValue('7.25');
  await expect(entered.locator('.aRolls')).toHaveValue('3');

  await page.locator('#reconMain').selectOption('أقمشة');
  await page.locator('#reconSub').selectOption('قطن');
  expect(await ids()).toEqual(expected.slice(1, 5));
  await page.locator('#clearReconFilters').click();
  await page.locator('#btnLoad').click();
  await expect(page.locator('#msg')).toContainText('تم التحميل');
  expect(await ids()).toEqual(expected);
  await expect(entered.locator('.aMain')).toHaveValue('7.25');
  await expect(entered.locator('.aRolls')).toHaveValue('3');

  await page.reload();
  await expect(rows).toHaveCount(6);
  expect(await ids()).toEqual(expected);
  await expect(entered.locator('.aMain')).toHaveValue('7.25');
  await expect(entered.locator('.aRolls')).toHaveValue('3');
});
