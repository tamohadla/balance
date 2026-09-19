import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStock,
  stockMatches,
  stockTotals,
  csvCell,
} from "../js/inventory-model.js";
test("inventory counts drafts and confirmed orders, excludes executed orders, and separates kilos from metres", () => {
  const items = [
    { id: "a", unit_type: "kg" },
    { id: "b", unit_type: "m" },
  ];
  const moves = [
    { item_id: "a", qty_main_in: "20.1", qty_main_out: ".1", qty_rolls_in: 6 },
    { item_id: "b", qty_main_out: 5, qty_rolls_out: 2 },
  ];
  const lines = [
    { item_id: "a", qty_rolls: 3, customer_orders: { status: "draft" } },
    { item_id: "a", qty_rolls: 5, customer_orders: [{ status: "confirmed" }] },
    { item_id: "a", qty_rolls: 10, customer_orders: { status: "executed" } },
  ];
  const rows = buildStock(items, moves, lines);
  assert.equal(rows[0].balance_main, 20);
  assert.equal(rows[0].balance_after_orders, -2);
  assert.equal(rows[0].preorder_total_rolls, 8);
  assert.equal(stockMatches(rows[0], "shortage"), true);
  assert.equal(stockMatches(rows[1], "shortage"), false);
  assert.equal(stockMatches(rows[1], "negative"), true);
  assert.deepEqual(stockTotals(rows), {
    items: 2,
    rolls: 4,
    reserved: 8,
    kg: 20,
    m: -5,
    other: 0,
  });
});
test("low stock excludes zero and negative balances and honours the chosen threshold", () => {
  for (const n of [-3, 0, 10])
    assert.equal(stockMatches({ balance_rolls: n }, "low_stock", 10), false);
  assert.equal(stockMatches({ balance_rolls: 9 }, "low_stock", 10), true);
  assert.equal(stockMatches({ balance_rolls: 9 }, "low_stock", 5), false);
  assert.equal(stockMatches({ balance_rolls: 0 }, "zero_rolls"), true);
  assert.equal(
    stockMatches({ balance_rolls: 2, balance_main: -0.01 }, "negative"),
    true,
  );
});
test("CSV escapes quotes and neutralizes spreadsheet formulas while preserving numeric negatives", () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell("=1+2"), '"\'=1+2"');
  assert.equal(csvCell("-cmd"), '"\'-cmd"');
  assert.equal(csvCell(-2.5), '"-2.5"');
});
