export function materialGroups(items) {
  const mains = new Map();
  for (const item of items) {
    const main = item.main_category ?? null,
      sub = item.sub_category ?? null;
    if (!mains.has(main)) mains.set(main, { main, items: [], subs: new Map() });
    const group = mains.get(main);
    group.items.push(item);
    if (!group.subs.has(sub)) group.subs.set(sub, { main, sub, items: [] });
    group.subs.get(sub).items.push(item);
  }
  return [...mains.values()]
    .sort((a, b) =>
      String(a.main || "").localeCompare(String(b.main || ""), "ar"),
    )
    .map((g) => ({
      ...g,
      subs: [...g.subs.values()].sort((a, b) =>
        String(a.sub || "").localeCompare(String(b.sub || ""), "ar"),
      ),
    }));
}
export function groupCounts(items) {
  const active = items.filter((i) => i.is_active === true).length;
  return { total: items.length, active, inactive: items.length - active };
}
export function groupQuery(query, target) {
  query =
    target.main === null
      ? query.is("main_category", null)
      : query.eq("main_category", target.main);
  if (target.level === "sub")
    query =
      target.sub === null
        ? query.is("sub_category", null)
        : query.eq("sub_category", target.sub);
  return query;
}
