import { supabase } from "./supabaseClient.js";
import { $, cleanText, escapeHtml, setMsg, materialLabel, getPublicImageUrl, todayISO, unitLabel, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";
import { initMovesBulkImport } from "./movesBulkImport.js";

const MOVE_TYPE = "purchase";
const msg = $("msg");
if(keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)){
  setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("tbody");
const rowsEl = $("rows");
const addRowBtn = $("addRow");
const quickFiltersEl = $("quickDateFilters");

let ITEMS = []; // active items only
let MOVE_CACHE = []; // moves for current date range
let LAST_RANGE = "";
let ACTIVE_QUICK_FILTER = "all";

async function loadItems(){
  const { data, error } = await supabase
    .from("items")
    .select("id, main_category, sub_category, item_name, color_code, color_name, unit_type, image_path, is_active")
    .eq("is_active", true)
    .order("main_category", { ascending: true })
    .order("sub_category", { ascending: true })
    .order("item_name", { ascending: true })
    .order("color_code", { ascending: true });

  if(error){ setMsg(msg, explainSupabaseError(error), false); return; }
  ITEMS = data || [];
}

function buildCombo(rowId){
  return `
    <div class="comboRow purchase-comboRow">
     
      <div class="combo purchase-combo">
        <input class="comboInput" type="text" placeholder="ابحث عن مادة..." autocomplete="off" />
        <div class="comboPanel"></div>
        <input type="hidden" class="itemId" value="" />
        <small class="muted unitHint"></small>
      </div>
       <div class="itemPreview" data-role="preview"><div class="ph">لا صورة</div></div>
    </div>
  `;
}

function filterItems(q){
  const s = (q || "").trim().toLowerCase();
  if(!s) return ITEMS.slice(0, 80);
  return ITEMS.filter(r => {
    const label = `${materialLabel(r)} ${r.color_code} ${r.color_name}`.toLowerCase();
    return label.includes(s);
  }).slice(0, 80);
}

function setSelected(rowBox, item){
  const input = rowBox.querySelector(".comboInput");
  const hidden = rowBox.querySelector(".itemId");
  const hint = rowBox.querySelector(".unitHint");
  const preview = rowBox.querySelector('.itemPreview[data-role="preview"]');

  hidden.value = item?.id || "";
  if(item){
    input.value = `${materialLabel(item)} | ${item.color_code} | ${item.color_name || ""}`.replace(/\s+\|\s+\|/g, " | ");
    hint.textContent = `وحدة الكمية الرئيسية: ${unitLabel(item.unit_type)}`;

    const url = getPublicImageUrl(item.image_path);
    if(preview){
      preview.innerHTML = url ? `<img src="${url}" alt="item" />` : `<div class="ph">لا صورة</div>`;
    }
  }else{
    if(preview) preview.innerHTML = `<div class="ph">لا صورة</div>`;
    hint.textContent = "";
  }
  updateInputSummary();
}

function wireCombo(rowBox){
  const input = rowBox.querySelector(".comboInput");
  const panel = rowBox.querySelector(".comboPanel");

  const render = (q) => {
    const list = filterItems(q);
    if(!list.length){
      panel.innerHTML = `<div class="comboEmpty">لا نتائج</div>`;
      return;
    }
    panel.innerHTML = list.map(it => {
      const title = `${materialLabel(it)}`;
      const meta = `${it.color_code} | ${it.color_name} | ${unitLabel(it.unit_type)}`;
      return `<div class="comboItem" data-id="${it.id}">
        <div style="flex:1; min-width:0;">
          <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(title)}</div>
          <div class="comboMeta">${escapeHtml(meta)}</div>
        </div>
      </div>`;
    }).join("");
  };

  const open = () => { panel.style.display = "block"; render(input.value); };
  const close = () => { panel.style.display = "none"; };

  input.addEventListener("focus", open);
  input.addEventListener("input", () => {
    panel.style.display = "block";
    render(input.value);
  });

  panel.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".comboItem");
    if(!itemEl) return;
    const id = itemEl.dataset.id;
    const it = ITEMS.find(x => x.id === id);
    setSelected(rowBox, it);
    close();
  });

  document.addEventListener("click", (e) => {
    if(rowBox.contains(e.target)) return;
    close();
  });
}

let rowSeq = 0;
function createRow(prefill = null, container = rowsEl){
  rowSeq += 1;
  const rowBox = document.createElement("div");
  rowBox.className = "rowBox purchaseRowBox";
  rowBox.dataset.row = String(rowSeq);

  const dateInputId = container.id === "editModalRows" ? "editModalDate" : "move_date";
  const activeDate = $(dateInputId)?.value || "-";
  rowBox.innerHTML = `
    <div class="rowHead purchaseRowHead">
      <div class="purchaseRowMeta">
        <span class="muted rowTag">سطر #${rowSeq}</span>
        <span class="purchaseDateBadge">تاريخ العملية: ${escapeHtml(activeDate)}</span>
      </div>
      <button type="button" class="danger smallBtn purchase-row-remove-btn btnRemove">حذف</button>
    </div>
    <div class="purchaseRowGrid">
      <div class="purchaseMaterialCell">
        <label>المادة</label>
        ${buildCombo(rowSeq)}
      </div>
      <div class="purchaseMainQtyCell">
        <label>الكمية الرئيسية</label>
        <input class="qtyMain" type="number" step="0.001" min="0" required />
      </div>
      <div class="purchaseRollsCell">
        <label>عدد الأثواب (عدد صحيح)</label>
        <input class="qtyRolls" type="number" step="1" min="1" required />
      </div>
      <div class="purchaseNoteCell">
        <label>ملاحظات (اختياري)</label>
        <input class="note" placeholder="مثال: إجمالي يومي/عميل/..." />
      </div>
    </div>
  `;

  rowBox.querySelector(".btnRemove").addEventListener("click", () => {
    // لا تسمح بإزالة آخر سطر
    if(container.children.length <= 1) {
      setMsg(msg, "لا يمكن حذف آخر سطر", false);
      return;
    }
    rowBox.remove();
    updateInputSummary();
  });

  container.appendChild(rowBox);
  wireCombo(rowBox);

  rowBox.querySelector(".qtyMain").addEventListener("input", updateInputSummary);
  rowBox.querySelector(".qtyRolls").addEventListener("input", updateInputSummary);

  if(prefill){
    const it = ITEMS.find(x => x.id === prefill.item_id);
    if(it) setSelected(rowBox, it);
    rowBox.querySelector(".qtyMain").value = prefill.qty_main ?? "";
    rowBox.querySelector(".qtyRolls").value = prefill.qty_rolls ?? "";
    rowBox.querySelector(".note").value = prefill.note ?? "";
  }

  updateInputSummary();
  return rowBox;
}

addRowBtn?.addEventListener("click", () => createRow());

function collectRowsData(container = rowsEl){
  const boxes = Array.from(container.querySelectorAll(".rowBox"));
  const out = [];
  for(const box of boxes){
    const item_id = box.querySelector(".itemId").value;
    const qty_main = Number(box.querySelector(".qtyMain").value);
    const qty_rolls = Number(box.querySelector(".qtyRolls").value);
    const note = cleanText(box.querySelector(".note").value) || null;
    out.push({ item_id, qty_main, qty_rolls, note });
  }
  return out;
}

function updateInputSummary(){
  const rows = collectRowsData(rowsEl);
  let totalMain = 0;
  let totalRolls = 0;
  for(const row of rows){
    if(Number.isFinite(row.qty_main) && row.qty_main > 0) totalMain += row.qty_main;
    if(Number.isFinite(row.qty_rolls) && row.qty_rolls > 0) totalRolls += row.qty_rolls;
  }
  $("sumRows").textContent = String(rows.length);
  $("sumQtyMain").textContent = totalMain.toFixed(3);
  $("sumQtyRolls").textContent = String(Math.round(totalRolls));
}

function getRowsData(){
  const out = collectRowsData(rowsEl);
  for(const row of out){
    const { item_id, qty_main, qty_rolls } = row;

    if(!item_id) return { error: "اختر مادة في جميع السطور" };
    if(!(qty_main > 0)) return { error: "الكمية الرئيسية يجب أن تكون أكبر من صفر في جميع السطور" };
    if(!Number.isInteger(qty_rolls) || qty_rolls <= 0) return { error: "عدد الأثواب يجب أن يكون عدد صحيح أكبر من صفر في جميع السطور" };
  }
  return { data: out };
}

function isDateInQuickFilter(dateISO){
  if(ACTIVE_QUICK_FILTER === "all") return true;
  const dt = new Date(`${dateISO}T00:00:00`);
  if(Number.isNaN(dt.getTime())) return false;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const moveStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diffDays = Math.floor((todayStart - moveStart) / 86400000);
  if(ACTIVE_QUICK_FILTER === "today") return diffDays === 0;
  if(ACTIVE_QUICK_FILTER === "yesterday") return diffDays === 1;
  if(ACTIVE_QUICK_FILTER === "7days") return diffDays >= 0 && diffDays <= 6;
  if(ACTIVE_QUICK_FILTER === "month"){
    return moveStart.getFullYear() === todayStart.getFullYear() && moveStart.getMonth() === todayStart.getMonth();
  }
  return true;
}

function renderMoves(){
  const q = ($("search").value || "").trim().toLowerCase();

  const rows = (MOVE_CACHE || []).filter(r => {
    if(!isDateInQuickFilter(r.move_date)) return false;
    if(!q) return true;
    const item = r.items;
    const mat = materialLabel(item);
    const hay = `${mat} ${item.color_code} ${item.color_name || ""} ${r.note || ""}`.toLowerCase();
    return hay.includes(q);
  });

  tbody.innerHTML = rows.map(r => {
    const item = r.items;
    const qtyMain = (r.qty_main_in || 0) - (r.qty_main_out || 0);
    const qtyRolls = (r.qty_rolls_in || 0) - (r.qty_rolls_out || 0);
    return `
      <tr>
        <td>${escapeHtml(r.move_date)}</td>
        <td>${escapeHtml(materialLabel(item))}</td>
        <td>${escapeHtml(item.color_code || "")}</td>
        <td>${escapeHtml(item.color_name || "")}</td>
        <td>${qtyMain.toFixed(3)} ${escapeHtml(unitLabel(item.unit_type))}</td>
        <td>${qtyRolls}</td>
        <td>${escapeHtml(r.note || "")}</td>
        <td>
          <button class="secondary smallBtn purchase-action-btn" data-act="edit" data-id="${r.id}">تعديل</button>
          <button class="danger smallBtn purchase-action-btn" data-act="del" data-id="${r.id}">حذف</button>
        </td>
      </tr>
    `;
  }).join("");

  setMsg(msg, `تم عرض ${rows.length} حركة`, true);
}

async function loadMoves(force=false){
  setMsg(msg, "تحميل...", true);
  tbody.innerHTML = "";

  const from = $("from").value;
  const to = $("to").value;
  const rangeKey = `${from || ""}..${to || ""}`;

  if(!force && LAST_RANGE === rangeKey && MOVE_CACHE.length){
    renderMoves();
    return;
  }

  let query = supabase
    .from("stock_moves")
    .select("id, move_date, item_id, qty_main_in, qty_main_out, qty_rolls_in, qty_rolls_out, note, items:items(*)")
    .eq("type", MOVE_TYPE)
    .order("move_date", { ascending: false });

  if(from) query = query.gte("move_date", from);
  if(to) query = query.lte("move_date", to);

  const { data, error } = await query;
  if(error){ setMsg(msg, explainSupabaseError(error), false); return; }

  MOVE_CACHE = data || [];
  LAST_RANGE = rangeKey;
  renderMoves();
}

$("btnReload").addEventListener("click", loadMoves);
$("search").addEventListener("input", () => { clearTimeout(window.__t2); window.__t2 = setTimeout(loadMoves, 250); });
$("from").addEventListener("change", loadMoves);
$("to").addEventListener("change", loadMoves);
quickFiltersEl?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-qf]");
  if(!btn) return;
  ACTIVE_QUICK_FILTER = btn.dataset.qf || "all";
  quickFiltersEl.querySelectorAll("button[data-qf]").forEach(b => b.classList.toggle("active", b === btn));
  renderMoves();
});

$("btnCancel").addEventListener("click", () => {
  $("editId").value = "";
  $("moveForm").reset();
  $("move_date").value = todayISO();
  rowsEl.innerHTML = "";
  createRow();
  setMsg(msg, "تم الإلغاء", true);
});

$("moveForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const move_date = $("move_date").value;
  if(!move_date) return setMsg(msg, "اختر التاريخ", false);

  const res = getRowsData();
  if(res.error) return setMsg(msg, res.error, false);

  const itemsRows = res.data;

  setMsg(msg, "جارٍ الحفظ...", true);

  const editId = $("editId").value || null;
  try{
    if(!editId){
      // insert many rows
      const payloads = itemsRows.map(r => {
        const p = {
          type: MOVE_TYPE,
          move_date,
          item_id: r.item_id,
          note: r.note,
          qty_main_in: 0,
          qty_main_out: 0,
          qty_rolls_in: 0,
          qty_rolls_out: 0
        };
        if(MOVE_TYPE === "purchase"){ p.qty_main_in = r.qty_main; p.qty_rolls_in = r.qty_rolls; }
        else { p.qty_main_out = r.qty_main; p.qty_rolls_out = r.qty_rolls; }
        return p;
      });

      const { error } = await supabase.from("stock_moves").insert(payloads);
      if(error) throw error;
    } else {
      // edit mode: we update single row only (first row)
      const first = itemsRows[0];
      const payload = {
        type: MOVE_TYPE,
        move_date,
        item_id: first.item_id,
        note: first.note,
        qty_main_in: 0,
        qty_main_out: 0,
        qty_rolls_in: 0,
        qty_rolls_out: 0
      };
      if(MOVE_TYPE === "purchase"){ payload.qty_main_in = first.qty_main; payload.qty_rolls_in = first.qty_rolls; }
      else { payload.qty_main_out = first.qty_main; payload.qty_rolls_out = first.qty_rolls; }

      const { error } = await supabase.from("stock_moves").update(payload).eq("id", editId);
      if(error) throw error;
    }

    $("editId").value = "";
    $("moveForm").reset();
    $("move_date").value = todayISO();
    rowsEl.innerHTML = "";
    createRow();
    setMsg(msg, "تم الحفظ", true);
    await loadMoves();
  }catch(ex){
    setMsg(msg, explainSupabaseError(ex), false);
  }
});

tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if(!btn) return;

  const act = btn.dataset.act;
  const id = btn.dataset.id;

  if(act === "edit"){
    const { data, error } = await supabase.from("stock_moves").select("*").eq("id", id).single();
    if(error) return setMsg(msg, explainSupabaseError(error), false);
    const modal = $("editPurchaseModal");
    $("editModalId").value = data.id;
    $("editModalDate").value = data.move_date;

    const qtyMain = (data.qty_main_in || 0) + (data.qty_main_out || 0);
    const qtyRolls = (data.qty_rolls_in || 0) + (data.qty_rolls_out || 0);
    const modalRows = $("editModalRows");
    modalRows.innerHTML = "";
    createRow({
      item_id: data.item_id,
      qty_main: qtyMain || "",
      qty_rolls: qtyRolls || "",
      note: data.note || ""
    }, modalRows);
    modal.style.display = "flex";
    return;
  }

  if(act === "del"){
    if(!confirm("تأكيد حذف الحركة؟")) return;
    const { error } = await supabase.from("stock_moves").delete().eq("id", id);
    if(error) return setMsg(msg, explainSupabaseError(error), false);
    await loadMoves();
  }
});

function closeEditModal(){
  $("editPurchaseModal").style.display = "none";
  $("editModalId").value = "";
  $("editModalRows").innerHTML = "";
  $("editPurchaseForm").reset();
}

$("btnCloseEditModal").addEventListener("click", closeEditModal);
$("btnCancelEditModal").addEventListener("click", closeEditModal);
$("editPurchaseModal").addEventListener("click", (e) => {
  if(e.target.id === "editPurchaseModal") closeEditModal();
});

$("editModalAddRow").addEventListener("click", () => createRow(null, $("editModalRows")));

$("editPurchaseForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("editModalId").value;
  const move_date = $("editModalDate").value;
  if(!id) return;
  if(!move_date) return setMsg(msg, "اختر التاريخ", false);

  const rows = collectRowsData($("editModalRows"));
  if(!rows.length) return setMsg(msg, "أضف سطرًا واحدًا على الأقل", false);
  for(const row of rows){
    if(!row.item_id) return setMsg(msg, "اختر مادة في جميع السطور", false);
    if(!(row.qty_main > 0)) return setMsg(msg, "الكمية الرئيسية يجب أن تكون أكبر من صفر في جميع السطور", false);
    if(!Number.isInteger(row.qty_rolls) || row.qty_rolls <= 0) return setMsg(msg, "عدد الأثواب يجب أن يكون عدد صحيح أكبر من صفر في جميع السطور", false);
  }

  const first = rows[0];
  const payload = {
    type: MOVE_TYPE,
    move_date,
    item_id: first.item_id,
    note: first.note,
    qty_main_in: MOVE_TYPE === "purchase" ? first.qty_main : 0,
    qty_main_out: MOVE_TYPE === "purchase" ? 0 : first.qty_main,
    qty_rolls_in: MOVE_TYPE === "purchase" ? first.qty_rolls : 0,
    qty_rolls_out: MOVE_TYPE === "purchase" ? 0 : first.qty_rolls
  };
  const { error } = await supabase.from("stock_moves").update(payload).eq("id", id);
  if(error) return setMsg(msg, explainSupabaseError(error), false);
  if(rows.length > 1){
    const extraPayloads = rows.slice(1).map((row) => ({
      type: MOVE_TYPE,
      move_date,
      item_id: row.item_id,
      note: row.note,
      qty_main_in: MOVE_TYPE === "purchase" ? row.qty_main : 0,
      qty_main_out: MOVE_TYPE === "purchase" ? 0 : row.qty_main,
      qty_rolls_in: MOVE_TYPE === "purchase" ? row.qty_rolls : 0,
      qty_rolls_out: MOVE_TYPE === "purchase" ? 0 : row.qty_rolls
    }));
    const { error: extraError } = await supabase.from("stock_moves").insert(extraPayloads);
    if(extraError) return setMsg(msg, explainSupabaseError(extraError), false);
  }
  closeEditModal();
  await loadMoves(true);
  setMsg(msg, "تم تحديث العملية بنجاح", true);
});

(async () => {
  const ok = await testSupabaseConnection(msg);
  if(!ok) return;

  await loadItems();
  initMovesBulkImport({ moveType: MOVE_TYPE, msgEl: msg, dateInput: $("move_date"), onDone: loadMoves });
  $("move_date").value = todayISO();
  rowsEl.innerHTML = "";
  createRow();
  updateInputSummary();
  await loadMoves();
})();
