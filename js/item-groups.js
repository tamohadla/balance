import {canManage} from './permissions.js?v=1';
import { supabase } from "./supabaseClient.js?v=permissions-1";
import { requireAccess } from "./auth-guard.js?v=permissions-1";
import { allRows } from "./stock-entries.js";
import { escapeHtml as esc } from "./shared.js?v=224-1";
import {
  materialGroups,
  groupCounts,
  groupQuery,
} from "./item-groups-model.js";
const $ = (id) => document.getElementById(id),
  canWrite = canManage((await requireAccess()).member,'items');
let items = [],
  targets = [],
  busy = false,
  loading = false,
  pending = null;
const mainLabel = (v) => v || "دون مجموعة أساسية",
  subLabel = (v) => v || "دون مجموعة فرعية";
function message(text, error = false) {
  $("groupsMsg").textContent = text;
  $("groupsMsg").dataset.error = String(error);
}
function counts(rows) {
  const c = groupCounts(rows);
  return `${c.total} صنف ولون · ${c.active} نشط · ${c.inactive} موقوف`;
}
function buttons(group, level) {
  if (!canWrite) return "";
  const id = targets.push({ ...group, level }) - 1,
    c = groupCounts(group.items);
  return `<div class="group-buttons"><button type="button" data-group="${id}" data-active="true" ${!c.inactive ? "disabled" : ""}>تشغيل ${level === "main" ? "المجموعة كاملة" : "الفرعية"}</button><button type="button" class="pause" data-group="${id}" data-active="false" ${!c.active ? "disabled" : ""}>إيقاف ${level === "main" ? "المجموعة كاملة" : "الفرعية"}</button></div>`;
}
function render() {
  targets = [];
  const q = $("groupSearch").value.trim().toLowerCase(),
    state = $("groupState").value;
  const match = (rows) => {
    const c = groupCounts(rows);
    return (
      state === "all" || (state === "active" ? c.active > 0 : c.inactive > 0)
    );
  };
  const groups = materialGroups(items)
    .map((g) => ({
      ...g,
      subs: g.subs.filter(
        (s) =>
          (!q ||
            `${mainLabel(g.main)} ${subLabel(s.sub)}`
              .toLowerCase()
              .includes(q)) &&
          match(s.items),
      ),
    }))
    .filter((g) => g.subs.length);
  $("groupsSummary").textContent =
    `${groups.length} مجموعة أساسية معروضة · إجمالي المواد: ${counts(items)}`;
  $("materialGroups").innerHTML =
    groups
      .map(
        (g) =>
          `<section class="main-group"><header><div><h2>${esc(mainLabel(g.main))}<span class="group-badge">أساسية</span></h2><div class="group-counts">${counts(g.items)} · الإجراء يشمل جميع فروعها</div></div>${buttons(g, "main")}</header><div class="sub-groups">${g.subs.map((s) => `<div class="sub-group"><div><strong>${esc(subLabel(s.sub))}</strong><div class="group-counts">${counts(s.items)}</div></div>${buttons(s, "sub")}</div>`).join("")}</div></section>`,
      )
      .join("") ||
    '<div class="empty-groups">لا توجد مجموعات مطابقة للبحث والفلتر.</div>';
}
async function load() {
  if (loading) return false;
  loading = true;
  $("reloadGroups").disabled = true;
  try {
    items = await allRows(() =>
      supabase
        .from("items")
        .select("id,main_category,sub_category,is_active")
        .order("id"),
    );
    render();
    return true;
  } catch (e) {
    message("تعذر تحميل المجموعات. أعد المحاولة. " + (e.message || ""), true);
    return false;
  } finally {
    loading = false;
    $("reloadGroups").disabled = false;
  }
}
$("materialGroups").onclick = (e) => {
  const b = e.target.closest("[data-group]");
  if (!b || busy || !canWrite) return;
  const g = targets[Number(b.dataset.group)],
    active = b.dataset.active === "true",
    c = groupCounts(g.items);
  pending = { main: g.main, sub: g.sub, level: g.level, active };
  $("confirmTitle").textContent = active ? "تشغيل المجموعة" : "إيقاف المجموعة";
  $("confirmDescription").textContent =
    g.level === "main"
      ? `المجموعة الأساسية «${mainLabel(g.main)}» بكل مجموعاتها الفرعية.`
      : `المجموعة الفرعية «${subLabel(g.sub)}» ضمن «${mainLabel(g.main)}» فقط.`;
  $("confirmCount").textContent =
    `${active ? "سيُشغّل" : "سيُوقف"} ${active ? c.inactive : c.active} صنف ولون من أصل ${c.total}. العدد حسب آخر تحديث؛ يشمل التنفيذ الأصناف الموجودة وقت التأكيد.`;
  $("applyGroup").textContent = active ? "تأكيد تشغيل الجميع" : "تأكيد الإيقاف";
  $("confirmMsg").textContent = "";
  $("groupConfirm").showModal();
};
$("confirmGroupForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!pending || busy || !canWrite) return;
  busy = true;
  $("applyGroup").disabled = true;
  $("cancelGroup").disabled = true;
  const target = { ...pending };
  try {
    // One SQL UPDATE through PostgREST: all matching rows succeed or roll back together.
    const { data, error } = await groupQuery(
      supabase.from("items").update({ is_active: target.active }),
      target,
    ).select("id");
    if (error) throw error;
    if (!data?.length)
      throw new Error(
        "لم يتم تعديل أي مادة. تحقق من الصلاحية أو حدّث المجموعات.",
      );
    $("groupConfirm").close();
    pending = null;
    const refreshed = await load();
    if (refreshed)
      message(
        `تم ${target.active ? "تشغيل" : "إيقاف"} ${target.level === "main" ? "المجموعة الأساسية بجميع فروعها" : "المجموعة الفرعية"} بنجاح.`,
      );
    else message("تم التعديل، لكن تعذر تحديث الأعداد. اضغط تحديث.", true);
  } catch (error) {
    $("confirmMsg").textContent =
      "تعذر التحقق من نتيجة التعديل. يمكنك إعادة نفس العملية بأمان أو تحديث الصفحة. " +
      (error.message || "");
  } finally {
    busy = false;
    $("applyGroup").disabled = false;
    $("cancelGroup").disabled = false;
  }
};
$("groupConfirm").addEventListener("cancel", (e) => {
  if (busy) e.preventDefault();
});
$("cancelGroup").onclick = () => {
  if (!busy) $("groupConfirm").close();
};
$("reloadGroups").onclick = () => {
  if (!busy) load();
};
$("groupSearch").oninput = render;
$("groupState").onchange = render;
if (!canWrite)
  message(
    "يمكنك مراجعة المجموعات. التشغيل والإيقاف متاحان للمستخدم المخوّل بإدارة المواد فقط.",
  );
await load();
