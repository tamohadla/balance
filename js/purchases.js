import { supabase } from "./supabaseClient.js";
import { $, cleanText, escapeHtml, setMsg, materialLabel, getPublicImageUrl, todayISO, unitLabel, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const MOVE_TYPE = "purchase";
const msg = $("msg");
if(keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)){
  setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("tbody");
const rowsEl = $("rows");
const addRowBtn = $("addRow");

let ITEMS = []; // active items only
let MOVE_CACHE = []; // moves for current date range
let LAST_RANGE = "";

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
    <div class="comboRow">
      <div class="itemPreview" data-role="preview"><div class="ph">لا صورة</div></div>
      <div class="combo">
        <input class="comboInput" type="text" placeholder="ابحث عن مادة..." autocomplete="off" />
        <div class="comboPanel"></div>
        <input type="hidden" class="itemId" value="" />
        <small class="muted unitHint"></small>
      </div>
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
function createRow(prefill = null){
  rowSeq += 1;
  const rowBox = document.createElement("div");
  rowBox.className = "rowBox";
  rowBox.dataset.row = String(rowSeq);

  rowBox.innerHTML = `
    <div class="rowHead">
      <span class="muted">سطر #${rowSeq}</span>
      <button type="button" class="danger smallBtn btnRemove">حذف السطر</button>
    </div>
    <div class="grid" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
      <div class="full">
        <label>المادة</label>
        ${buildCombo(rowSeq)}
      </div>
      <div>
        <label>الكمية الرئيسية</label>
        <input class="qtyMain" type="number" step="0.001" min="0" required />
      </div>
      <div>
        <label>عدد الأثواب (عدد صحيح)</label>
        <input class="qtyRolls" type="number" step="1" min="1" required />
      </div>
      <div class="full">
        <label>ملاحظات (اختياري)</label>
        <input class="note" placeholder="مثال: إجمالي يومي/عميل/..." />
      </div>
    </div>
  `;

  rowBox.querySelector(".btnRemove").addEventListener("click", () => {
    // لا تسمح بإزالة آخر سطر
    if(rowsEl.children.length <= 1) {
      setMsg(msg, "لا يمكن حذف آخر سطر", false);
      return;
    }
    rowBox.remove();
  });

  rowsEl.appendChild(rowBox);
  wireCombo(rowBox);

  if(prefill){
    const it = ITEMS.find(x => x.id === prefill.item_id);
    if(it) setSelected(rowBox, it);
    rowBox.querySelector(".qtyMain").value = prefill.qty_main ?? "";
    rowBox.querySelector(".qtyRolls").value = prefill.qty_rolls ?? "";
    rowBox.querySelector(".note").value = prefill.note ?? "";
  }

  return rowBox;
}

addRowBtn?.addEventListener("click", () => createRow());

function getRowsData(){
  const boxes = Array.from(rowsEl.querySelectorAll(".rowBox"));
  const out = [];
  for(const box of boxes){
    const item_id = box.querySelector(".itemId").value;
    const qty_main = Number(box.querySelector(".qtyMain").value);
    const qty_rolls = Number(box.querySelector(".qtyRolls").value);
    const note = cleanText(box.querySelector(".note").value) || null;

    if(!item_id) return { error: "اختر مادة في جميع السطور" };
    if(!(qty_main > 0)) return { error: "الكمية الرئيسية يجب أن تكون أكبر من صفر في جميع السطور" };
    if(!Number.isInteger(qty_rolls) || qty_rolls <= 0) return { error: "عدد الأثواب يجب أن يكون عدد صحيح أكبر من صفر في جميع السطور" };

    out.push({ item_id, qty_main, qty_rolls, note });
  }
  return { data: out };
}

function renderMoves(){
  const q = ($("search").value || "").trim().toLowerCase();

  const rows = (MOVE_CACHE || []).filter(r => {
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
        <td>${escapeHtml(item.color_code)} / ${escapeHtml(item.color_name || "")}</td>
        <td>${qtyMain.toFixed(3)} ${escapeHtml(unitLabel(item.unit_type))}</td>
        <td>${qtyRolls}</td>
        <td>${escapeHtml(r.note || "")}</td>
        <td>
          <button class="secondary smallBtn" data-act="edit" data-id="${r.id}">تعديل</button>
          <button class="danger smallBtn" data-act="del" data-id="${r.id}">حذف</button>
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

    $("editId").value = data.id;
    $("move_date").value = data.move_date;

    const qtyMain = (data.qty_main_in || 0) + (data.qty_main_out || 0);
    const qtyRolls = (data.qty_rolls_in || 0) + (data.qty_rolls_out || 0);

    rowsEl.innerHTML = "";
    createRow({
      item_id: data.item_id,
      qty_main: qtyMain || "",
      qty_rolls: qtyRolls || "",
      note: data.note || ""
    });

    setMsg(msg, "وضع التعديل مفعل (سيتم تعديل سطر واحد فقط).", true);
    return;
  }

  if(act === "delete"){
    if(!confirm("تأكيد حذف الحركة؟")) return;
    const { error } = await supabase.from("stock_moves").delete().eq("id", id);
    if(error) return setMsg(msg, explainSupabaseError(error), false);
    await loadMoves();
  }
});

(async () => {
  const ok = await testSupabaseConnection(msg);
  if(!ok) return;

  await loadItems();
  $("move_date").value = todayISO();
  rowsEl.innerHTML = "";
  createRow();
  await loadMoves();
})();
