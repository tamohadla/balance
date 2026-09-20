import { supabase } from "./supabaseClient.js";
import { requireAccess } from "./auth-guard.js";
import {
  escapeHtml as esc,
  materialLabel,
  unitLabel,
  getThumbnailImageUrl,
  todayISO,
} from "./shared.js?v=200-1";
import { allRows, saveEntry, entryError, quantities } from "./stock-entries.js";
import { initMovesBulkImport } from "./movesBulkImport.js?v=2";
const $ = (id) => document.getElementById(id),
  type = document.body.dataset.moveType,
  review = type === "sale" ? "sales-review.html" : "purchases-review.html";
const access = await requireAccess(),
  admin = access.member.role === "admin";
let pendingOrderId = null;
let items = [],
  busy = false,
  pending = null,
  prefill = null;
const pendingKey = `stock-entry-pending:${access.user.id}:${type}`,
  prefillKey = "sales_prefill_from_order";
const fmt = (n) =>
  Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
function message(text, error = false) {
  $("msg").className = "stock-message";
  $("msg").textContent = text;
  $("msg").classList.toggle("error", error);
}
function summary() {
  const lines = [...$("rows").children].map((row) => ({
    qty_main: Number(row.querySelector(".qtyMain").value),
    qty_rolls: Number(row.querySelector(".qtyRolls").value),
    unit_type: items.find((i) => i.id === row.dataset.item)?.unit_type,
  }));
  const t = quantities(lines, type);
  $("entrySummary").innerHTML =
    `<div class="summary-line"><span>عدد البنود</span><strong>${lines.length}</strong></div>${Object.entries(
      t.units,
    )
      .map(
        ([u, n]) =>
          `<div class="summary-line"><span>${esc(unitLabel(u))}</span><strong>${fmt(n)}</strong></div>`,
      )
      .join(
        "",
      )}<div class="summary-line"><span>إجمالي الأثواب</span><strong>${fmt(t.rolls)}</strong></div>`;
}
function addRow(line = {}) {
  const row = document.createElement("div");
  row.className = "entry-row";
  row.innerHTML = `<div class="entry-row-top"><div class="entry-image">صورة المادة</div><div class="entry-row-main"><span class="row-number">اختر المادة واللون</span><div class="item-picker"><input class="itemSearch" aria-label="بحث واختيار المادة" placeholder="ابحث عن مادة أو لون…" autocomplete="off" required role="combobox" aria-autocomplete="list" aria-expanded="false"><div class="item-results" role="listbox" hidden></div></div><p class="selected-item helper"></p><button type="button" class="text-btn remove-row">حذف البند</button></div></div><div class="row-fields"><label>الكمية <span class="unit"></span><input class="qtyMain" type="number" inputmode="decimal" min="0.001" max="999999999" step="0.001" required></label><label>عدد الأثواب<input class="qtyRolls" type="number" inputmode="numeric" min="0" max="1000000" step="1" required></label><label>ملاحظة البند<input class="lineNote" maxlength="2000" placeholder="اختياري"></label></div>`;
  const input = row.querySelector(".itemSearch"),
    list = row.querySelector(".item-results");
  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }
  function choose(item) {
    row.dataset.item = item.id;
    row.querySelector(".selected-item").textContent =
      `${item.item_name} · ${item.color_code || ""} ${item.color_name || ""}`;
    input.value = `${materialLabel(item)} · ${item.color_code || ""} ${item.color_name || ""}`;
    input.setCustomValidity("");
    row.querySelector(".unit").textContent = unitLabel(item.unit_type);
    const img = row.querySelector(".entry-image");
    img.replaceChildren();
    const url = getThumbnailImageUrl(item.image_path);
    if (url) {
      const im = document.createElement("img");
      im.src = url;
      im.alt = item.item_name;
      im.className = "entry-image";
      im.loading = "lazy";
      img.append(im);
    } else img.textContent = "لا توجد صورة";
    close();
    summary();
  }
  function open() {
    const q = input.value.trim().toLowerCase();
    const found = items
      .filter((i) =>
        `${materialLabel(i)} ${i.color_code} ${i.color_name}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 60);
    list.innerHTML = found.length
      ? found
          .map(
            (i) =>
              `<button type="button" role="option" data-id="${i.id}">${esc(materialLabel(i))}<small>${esc(i.color_code || "")} · ${esc(i.color_name || "")} · ${esc(unitLabel(i.unit_type))}</small></button>`,
          )
          .join("")
      : '<p class="helper">لا توجد مواد مطابقة</p>';
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  input.addEventListener("input", () => {
    delete row.dataset.item;
    row.querySelector(".selected-item").textContent = "";
    input.setCustomValidity("اختر المادة من نتائج البحث");
    row.querySelector(".unit").textContent = "";
    row.querySelector(".entry-image").textContent = "صورة المادة";
    open();
    summary();
  });
  input.addEventListener("focus", () => {
    if (!row.dataset.item) open();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (list.hidden) open();
      list.querySelector("button")?.focus();
    }
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    if (b) {
      choose(items.find((i) => i.id === b.dataset.id));
      row.querySelector(".qtyMain").focus();
    }
  });
  list.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      input.focus();
    }
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      (e.key === "ArrowDown"
        ? e.target.nextElementSibling
        : e.target.previousElementSibling
      )?.focus();
    }
  });
  row.addEventListener("focusout", () =>
    setTimeout(() => {
      if (!row.contains(document.activeElement)) close();
    }, 0),
  );
  row.querySelector(".remove-row").onclick = () => {
    row.remove();
    if (!$("rows").children.length) addRow();
    summary();
  };
  row.addEventListener("input", summary);
  $("rows").append(row);
  if (line.item_id) {
    const item = items.find((i) => i.id === line.item_id);
    if (item) choose(item);
    else {
      input.value = "مادة غير متاحة — اختر بديلًا";
      input.setCustomValidity("اختر مادة متاحة");
    }
  }
  row.querySelector(".qtyMain").value = line.qty_main ?? "";
  row.querySelector(".qtyRolls").value = line.qty_rolls ?? "";
  if (line.requested_rolls)
    row.querySelector(".qtyRolls").placeholder =
      `المطلوب: ${line.requested_rolls}`;
  row.querySelector(".lineNote").value = line.note || "";
  summary();
  return row;
}
function clearPrefill() {
  if (!prefill) return;
  try {
    const stored = JSON.parse(localStorage.getItem(prefillKey) || "null");
    if (stored?.order_id === prefill.order_id)
      localStorage.removeItem(prefillKey);
  } catch {}
  prefill = null;
  $("orderPrefillNotice").hidden = true;
  const u = new URL(location.href);
  u.searchParams.delete("prefill");
  history.replaceState(null, "", u);
}
function completed(id) {
  message("تم حفظ المجموعة بنجاح. ");
  const a = document.createElement("a");
  a.href = `${review}?group=${encodeURIComponent(id)}`;
  a.textContent = "عرض المجموعة ومراجعتها ←";
  $("msg").append(a);
}
function lock(value) {
  busy = value;
  $("entryFields").disabled = value;
  $("saveEntry").disabled = value;
  $("btnCancel").disabled = value;
  $("btnBulkImport").disabled = value;
  $("saveEntry").textContent = value ? "جارٍ حفظ المجموعة…" : "حفظ المجموعة";
}
$("move_date").value = todayISO();
$("addRow").onclick = $("addRowBottom").onclick = () =>
  addRow().querySelector(".itemSearch").focus();
$("btnCancel").onclick = () => {
  if (!confirm("تفريغ بنود الإدخال الحالية؟ لن يحذف هذا أي مجموعة محفوظة."))
    return;
  if (pending) {
    message(
      "هناك محاولة حفظ لم تُحسم. أعد محاولة الحفظ أو راجع السجل قبل بدء مجموعة جديدة.",
      true,
    );
    return;
  }
  clearPrefill();
  $("rows").replaceChildren();
  $("groupNote").value = "";
  addRow();
};
$("moveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy || !admin) return;
  try {
    const lines = [...$("rows").children].map((row) => {
      if (!row.dataset.item) throw new Error("اختر كل مادة من نتائج البحث.");
      return {
        item_id: row.dataset.item,
        move_date: $("move_date").value,
        qty_main: Number(row.querySelector(".qtyMain").value),
        qty_rolls: Number(row.querySelector(".qtyRolls").value),
        note: row.querySelector(".lineNote").value.trim() || null,
      };
    });
    const request = {
      p_type: type,
      p_source: "manual",
      p_note: $("groupNote").value.trim() || null,
      p_file: null,
      p_lines: lines,
    };
    if (
      pending &&
      JSON.stringify({ ...pending, p_id: undefined }) !==
        JSON.stringify(request)
    ) {
      message(
        "بيانات هذه المحاولة تغيّرت. أعد تحميل الصفحة لاستعادة المحاولة السابقة ثم احفظها للتحقق من نتيجتها.",
        true,
      );
      return;
    }
    if (!pending) pendingOrderId = prefill?.order_id || null;
    pending = pending || { ...request, p_id: crypto.randomUUID() };
    try {
      localStorage.setItem(
        pendingKey,
        JSON.stringify({ request: pending, order_id: pendingOrderId }),
      );
    } catch {
      throw new Error(
        "تعذر حفظ حماية إعادة المحاولة في المتصفح. أتح مساحة تخزين ثم حاول مجددًا.",
      );
    }
    lock(true);
    const id = await saveEntry(pending);
    localStorage.removeItem(pendingKey);
    pending = null;
    if (!prefill || pendingOrderId === prefill.order_id) clearPrefill();
    pendingOrderId = null;
    $("rows").replaceChildren();
    $("groupNote").value = "";
    if (prefill?.lines?.length)
      prefill.lines.forEach((l) =>
        addRow({ ...l, note: `من طلب: ${prefill.customer_name || ""}` }),
      );
    else addRow();
    completed(id);
  } catch (error) {
    if (error?.code && !["57014", "08000", "08006"].includes(error.code)) {
      localStorage.removeItem(pendingKey);
      pending = null;
    }
    message(entryError(error), true);
  } finally {
    lock(false);
  }
});
try {
  items = await allRows(() =>
    supabase
      .from("items")
      .select(
        "id,main_category,sub_category,item_name,color_code,color_name,unit_type,image_path,is_active",
      )
      .eq("is_active", true)
      .order("id"),
  );
  if (!admin) {
    $("entryFields").disabled = true;
    $("saveEntry").disabled = true;
    $("btnCancel").disabled = true;
    $("btnBulkImport").disabled = true;
    message(
      "حسابك يتيح المراجعة. إدخال حركات المخزون متاح للمستخدم المخوّل فقط.",
    );
  }
  if (
    type === "sale" &&
    new URL(location.href).searchParams.get("prefill") === "order"
  ) {
    try {
      prefill = JSON.parse(localStorage.getItem(prefillKey) || "null");
    } catch {}
    if (prefill?.source !== "customer_order") prefill = null;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(pendingKey) || "null");
    pending = saved?.request || saved;
    pendingOrderId = saved?.order_id || null;
  } catch {}
  if (pending) {
    $("move_date").value = pending.p_lines[0]?.move_date || todayISO();
    $("groupNote").value = pending.p_note || "";
    pending.p_lines.forEach(addRow);
    message(
      "استُعيدت محاولة الحفظ السابقة. اضغط حفظ للتحقق وإكمالها دون تكرار المجموعة.",
    );
  } else if (prefill?.lines?.length) {
    $("orderPrefillNotice").hidden = false;
    $("orderPrefillNotice").textContent =
      `مبيعات من طلب: ${prefill.customer_name || ""}. أدخل الكميات الفعلية؛ سيبقى الطلب محفوظًا هنا حتى نجاح الحفظ أو تفريغ الإدخال.`;
    prefill.lines.forEach((l, i) =>
      addRow({
        ...l,
        note:
          i === 0
            ? `من طلب: ${prefill.customer_name || ""} ${prefill.customer_phone || ""}`
            : "",
      }),
    );
  } else {
    const item = new URL(location.href).searchParams.get("item");
    addRow(item ? { item_id: item } : {});
  }
  initMovesBulkImport({
    moveType: type,
    msgEl: $("msg"),
    dateInput: $("move_date"),
    onDone: completed,
    userId: access.user.id,
  });
} catch (e) {
  message(entryError(e), true);
  $("saveEntry").disabled = true;
}
