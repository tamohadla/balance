import test from "node:test";
import assert from "node:assert/strict";
import {
  materialGroups,
  groupCounts,
  groupQuery,
} from "../js/item-groups-model.js";
test("group membership preserves exact parent and child names, including blank categories", () => {
  const rows = [
    { main_category: "صيف", sub_category: "قطن", is_active: true },
    { main_category: "شتاء", sub_category: "قطن", is_active: false },
    { main_category: "صيف", sub_category: "قطن", is_active: false },
    { main_category: null, sub_category: null, is_active: true },
    { main_category: "", sub_category: "", is_active: true },
  ];
  const groups = materialGroups(rows);
  assert.equal(groups.length, 4);
  const summer = groups.find((g) => g.main === "صيف");
  assert.equal(summer.subs.length, 1);
  assert.deepEqual(groupCounts(summer.items), {
    total: 2,
    active: 1,
    inactive: 1,
  });
});
test("subgroup updates always scope by parent; whole group updates do not scope by child", () => {
  const calls = [];
  const q = {
    eq: (...a) => {
      calls.push(["eq", ...a]);
      return q;
    },
    is: (...a) => {
      calls.push(["is", ...a]);
      return q;
    },
  };
  groupQuery(q, { main: "صيف", sub: "قطن", level: "sub" });
  assert.deepEqual(calls, [
    ["eq", "main_category", "صيف"],
    ["eq", "sub_category", "قطن"],
  ]);
  calls.length = 0;
  groupQuery(q, { main: "صيف", sub: "قطن", level: "main" });
  assert.deepEqual(calls, [["eq", "main_category", "صيف"]]);
  calls.length = 0;
  groupQuery(q, { main: null, sub: "", level: "sub" });
  assert.deepEqual(calls, [
    ["is", "main_category", null],
    ["eq", "sub_category", ""],
  ]);
});
