import { supabase } from "./supabaseClient.js";
import { requireAccess } from "./auth-guard.js";
import { escapeHtml as esc, materialLabel, unitLabel } from "./shared.js";
import {
  allRows,
  changeEntry,
  entryError,
  quantities,
} from "./stock-entries.js";
const $ = (id) => document.getElementById(id),
  type = document.body.dataset.moveType,
  admin = (await requireAccess()).member.role === "admin";
let groups = [],
  moves = [],
  lineIndex = new Map(),
  source = "all",
  page = 0,
  active = null,
  editing = null,
  busy = false,
  editItems = [];
const size = 20,
  fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 }),
  stamp = (s) =>
    s
      ? new Date(s).toLocaleString("ar-EG", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "غير مسجل";
const sources = {
  manual: "إدخال يدوي",
  excel: "استيراد Excel",
  import: "استيراد متقدم",
  legacy: "بيانات قديمة",
};
const linesOf = (id) => lineIndex.get(id) || [];
const totals = (lines) => {
  const t = quantities(lines, type);
  return (
    Object.entries(t.units)
      .map(([u, n]) => `${fmt(n)} ${esc(unitLabel(u))}`)
      .join(" · ") + `<br>${fmt(t.rolls)} ثوب`
  );
};
function message(s, error = false) {
  $("msg").textContent = s;
  $("msg").classList.toggle("error", error);
}
function filtered() {
  const q = $("search").value.trim().toLowerCase(),
    from = $("from").value,
    to = $("to").value;
  return groups.filter((g) => {
    const date = new Date(g.created_at),
      day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return (
      !g.deleted_at &&
      linesOf(g.id).length &&
      (source === "all" ||
        g.source === source ||
        (source === "excel" && g.source === "import")) &&
      (!from || day >= from) &&
      (!to || day <= to) &&
      (!q ||
        `${g.id} ${g.note || ""} ${g.source_file_name || ""} ${g.created_by_name || ""} ${linesOf(
          g.id,
        )
          .map(
            (l) =>
              `${materialLabel(l.items)} ${l.items?.color_code || ""} ${l.note || ""}`,
          )
          .join(" ")}`
          .toLowerCase()
          .includes(q))
    );
  });
}
function render() {
  const list = filtered();
  page = Math.min(page, Math.max(0, Math.ceil(list.length / size) - 1));
  const ids = new Set(list.map((g) => g.id)),
    visibleMoves = moves.filter((m) => ids.has(m.entry_group_id));
  $("reviewStats").innerHTML =
    `<div><span class="helper">المجموعات المطابقة</span><strong>${list.length}</strong></div><div><span class="helper">البنود</span><strong>${visibleMoves.length}</strong></div><div><span class="helper">إجمالي الأثواب</span><strong>${fmt(quantities(visibleMoves, type).rolls)}</strong></div>`;
  $("resultCount").textContent = `${list.length} مجموعة`;
  $("groups").innerHTML = list.length
    ? list
        .slice(page * size, (page + 1) * size)
        .map(
          (g) =>
            `<article class="group-card"><div><span class="pill">${sources[g.source]}</span><h3>${esc(g.note || g.source_file_name || `مجموعة ${g.id.slice(0, 8).toUpperCase()}`)}</h3><div class="group-meta">${esc(stamp(g.created_at))}<br>أدخلها: ${esc(g.created_by_name || "غير مسجل — بيانات قديمة")}</div></div><div class="group-totals"><strong>${linesOf(g.id).length} بند</strong><br>${totals(linesOf(g.id))}</div><button data-open="${g.id}" class="secondary">عرض التفاصيل ←</button></article>`,
        )
        .join("")
    : '<div class="empty-state">لا توجد مجموعات مطابقة.<br>جرّب تغيير البحث أو الفلاتر.</div>';
  $("pageInfo").textContent =
    `${page + 1} / ${Math.max(1, Math.ceil(list.length / size))}`;
  $("previous").disabled = page === 0;
  $("next").disabled = (page + 1) * size >= list.length;
}
async function load() {
  $("btnReload").disabled = true;
  try {
    const [g, m] = await Promise.all([
      allRows(() =>
        supabase
          .from("stock_entry_groups")
          .select("*")
          .eq("type", type)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .order("id"),
      ),
      allRows(() =>
        supabase
          .from("stock_moves")
          .select(
            "id,entry_group_id,item_id,move_date,note,qty_main_in,qty_main_out,qty_rolls_in,qty_rolls_out,items(id,main_category,sub_category,item_name,color_code,color_name,unit_type)",
          )
          .eq("type", type)
          .order("id"),
      ),
    ]);
    groups = g;
    moves = m;
    lineIndex = new Map();
    for (const line of m) {
      if (!lineIndex.has(line.entry_group_id))
        lineIndex.set(line.entry_group_id, []);
      lineIndex.get(line.entry_group_id).push(line);
    }
    render();
    return true;
  } catch (e) {
    message(entryError(e), true);
    return false;
  } finally {
    $("btnReload").disabled = false;
  }
}
function showGroup(id) {
  active = groups.find((g) => g.id === id);
  if (!active || !linesOf(id).length) {
    $("groupDialog").close();
    return;
  }
  const lines = linesOf(id);
  $("dialogTitle").textContent =
    active.note ||
    active.source_file_name ||
    `مجموعة ${id.slice(0, 8).toUpperCase()}`;
  $("dialogMeta").textContent =
    `${sources[active.source]} · ${stamp(active.created_at)} · أدخلها: ${active.created_by_name || "غير مسجل"}${active.updated_by_name ? " · آخر تحديث: " + active.updated_by_name + "، " + stamp(active.updated_at) : ""}`;
  $("groupLines").innerHTML =
    `<div class="lines-table"><table><thead><tr><th>المادة واللون</th><th>تاريخ الحركة</th><th>الكمية</th><th>الأثواب</th><th>ملاحظة</th>${admin ? "<th>الإجراءات</th>" : ""}</tr></thead><tbody>${lines.map((l) => `<tr><td>${esc(materialLabel(l.items))}<div class="helper">${esc(l.items?.color_code || "")} · ${esc(l.items?.color_name || "")}</div></td><td>${esc(l.move_date || "—")}</td><td>${fmt(type === "purchase" ? l.qty_main_in : l.qty_main_out)} ${esc(unitLabel(l.items?.unit_type))}</td><td>${fmt(type === "purchase" ? l.qty_rolls_in : l.qty_rolls_out)}</td><td>${esc(l.note || "—")}</td>${admin ? `<td><button class="secondary" data-edit="${l.id}">تعديل</button><button class="danger" data-delete="${l.id}">حذف</button></td>` : ""}</tr>`).join("")}</tbody></table></div><p class="group-totals">إجمالي المجموعة: ${totals(lines)}</p>`;
  $("deleteGroup").hidden = !admin;
  if (!$("groupDialog").open) $("groupDialog").showModal();
}
async function mutate(action, line, values, target) {
  if (busy) return;
  busy = true;
  target.textContent = "جارٍ حفظ التغيير…";
  document
    .querySelectorAll("#groupDialog button,#editDialog button")
    .forEach((b) => (b.disabled = true));
  try {
    await changeEntry(active, action, line, values);
    target.textContent = "تم حفظ التغيير.";
    $("editDialog").close();
    if (await load()) showGroup(active.id);
    else $("groupDialog").close();
  } catch (e) {
    target.textContent = entryError(e);
  } finally {
    busy = false;
    document
      .querySelectorAll("#groupDialog button,#editDialog button")
      .forEach((b) => (b.disabled = false));
  }
}
$("groups").onclick = (e) => {
  const b = e.target.closest("[data-open]");
  if (b) {
    $("dialogMsg").textContent = "";
    showGroup(b.dataset.open);
  }
};
$("closeGroup").onclick = () => $("groupDialog").close();
$("cancelEdit").onclick = () => $("editDialog").close();
for (const id of ["groupDialog", "editDialog"])
  $(id).addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
$("deleteGroup").onclick = () => {
  if (
    confirm(
      `حذف المجموعة كاملة (${linesOf(active.id).length} بند)؟ سيُعاد حساب المخزون ولا يمكن التراجع من هذه الصفحة.`,
    )
  )
    mutate("delete_group", null, null, $("dialogMsg"));
};
$("groupLines").onclick = (e) => {
  const edit = e.target.closest("[data-edit]"),
    del = e.target.closest("[data-delete]");
  if (del && confirm("حذف هذا البند من المجموعة والمخزون؟"))
    mutate("delete_line", del.dataset.delete, null, $("dialogMsg"));
  if (edit) {
    editing = moves.find((l) => l.id === edit.dataset.edit);
    $("editItem").textContent =
      `${materialLabel(editing.items)} · ${editing.items?.color_code || ""}`;
    $("editDate").value = editing.move_date;
    $("editQty").value =
      type === "purchase" ? editing.qty_main_in : editing.qty_main_out;
    $("editRolls").value =
      type === "purchase" ? editing.qty_rolls_in : editing.qty_rolls_out;
    $("editNote").value = editing.note || "";
    $("editMaterial").innerHTML = editItems
      .concat(
        editItems.some((i) => i.id === editing.item_id) ? [] : [editing.items],
      )
      .filter(Boolean)
      .map(
        (i) =>
          `<option value="${i.id}">${esc(materialLabel(i))} · ${esc(i.color_code || "")} · ${esc(i.color_name || "")}</option>`,
      )
      .join("");
    $("editMaterial").value = editing.item_id;
    $("editMsg").textContent = "";
    $("editDialog").showModal();
  }
};
$("editForm").onsubmit = (e) => {
  e.preventDefault();
  mutate(
    "edit_line",
    editing.id,
    {
      item_id: $("editMaterial").value,
      move_date: $("editDate").value,
      qty_main: Number($("editQty").value),
      qty_rolls: Number($("editRolls").value),
      note: $("editNote").value.trim() || null,
    },
    $("editMsg"),
  );
};
for (const id of ["search", "from", "to"])
  $(id).addEventListener("input", () => {
    page = 0;
    render();
  });
$("sourceFilters").onclick = (e) => {
  const b = e.target.closest("[data-source]");
  if (b) {
    source = b.dataset.source;
    page = 0;
    document
      .querySelectorAll("[data-source]")
      .forEach((n) => n.setAttribute("aria-pressed", String(n === b)));
    render();
  }
};
$("previous").onclick = () => {
  page--;
  render();
};
$("next").onclick = () => {
  page++;
  render();
};
$("btnReload").onclick = () => load();
if (admin) {
  try {
    editItems = await allRows(() =>
      supabase
        .from("items")
        .select("id,main_category,sub_category,item_name,color_code,color_name")
        .eq("is_active", true)
        .order("id"),
    );
  } catch (e) {
    message(entryError(e), true);
  }
}
const initialParams = new URL(location.href).searchParams;
for (const key of ["from", "to"]) {
  const value = initialParams.get(key);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value || "")) $(key).value = value;
}
message("جارٍ تحميل سجل المجموعات…");
if (await load()) {
  message("");
  const id = new URL(location.href).searchParams.get("group");
  if (id) showGroup(id);
}
