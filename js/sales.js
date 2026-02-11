import { supabase } from "./supabaseClient.js";
import { $, cleanText, escapeHtml, setMsg, materialLabel, todayISO, unitLabel, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const MOVE_TYPE = "sale";
const msg = $("msg");
if(keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)){
  setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("tbody");
const itemSelect = $("item_id");
const unitHint = $("unitHint");

async function loadItems(){
  const { data, error } = await supabase
    .from("items")
    .select("id, main_category, sub_category, item_name, color_code, color_name, unit_type, is_active")
    .eq("is_active", true)
    .order("main_category", { ascending: true })
    .order("sub_category", { ascending: true })
    .order("item_name", { ascending: true })
    .order("color_code", { ascending: true });

  if(error){ setMsg(msg, explainSupabaseError(error), false); return; }

  itemSelect.innerHTML = `<option value="">اختر مادة...</option>` + (data||[]).map(r => {
    const label = `${materialLabel(r)} | ${r.color_code} | ${r.color_name}`;
    return `<option value="${r.id}" data-unit="${r.unit_type}">${escapeHtml(label)}</option>`;
  }).join("");
}

function refreshUnitHint(){
  const opt = itemSelect.selectedOptions?.[0];
  const unit = opt?.dataset?.unit || "";
  unitHint.textContent = unit ? `وحدة الكمية الرئيسية لهذه المادة: ${unitLabel(unit)}` : "";
}
itemSelect.addEventListener("change", refreshUnitHint);

function validate(){
  const qtyMain = Number($("qty_main").value);
  const qtyRolls = Number($("qty_rolls").value);

  if(!itemSelect.value) return "اختر مادة";
  if(!$("move_date").value) return "اختر التاريخ";
  if(!(qtyMain > 0)) return "الكمية الرئيسية يجب أن تكون أكبر من صفر";
  if(!Number.isInteger(qtyRolls) || qtyRolls <= 0) return "عدد الأثواب يجب أن يكون عدد صحيح أكبر من صفر";
  return null;
}

async function loadMoves(){
  setMsg(msg, "تحميل...", true);
  tbody.innerHTML = "";

  const q = $("search").value.trim();
  const from = $("from").value;
  const to = $("to").value;

  let query = supabase
    .from("stock_moves")
    .select("id, move_date, item_id, qty_main_in, qty_main_out, qty_rolls_in, qty_rolls_out, note, items:items(*)")
    .eq("type", MOVE_TYPE)
    .order("move_date", { ascending: false });

  if(from) query = query.gte("move_date", from);
  if(to) query = query.lte("move_date", to);

  const { data, error } = await query;
  if(error){ setMsg(msg, explainSupabaseError(error), false); return; }

  const rows = (data || []).filter(r => {
    if(!q) return true;
    const mat = materialLabel(r.items);
    const hay = `${mat} ${r.items.color_code} ${r.items.color_name} ${r.note || ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  tbody.innerHTML = rows.map(r => {
    const item = r.items;
    const qtyMain = (r.qty_main_in || 0) - (r.qty_main_out || 0);
    const qtyRolls = (r.qty_rolls_in || 0) - (r.qty_rolls_out || 0);
    return `
      <tr>
        <td>${escapeHtml(r.move_date)}</td>
        <td>${escapeHtml(materialLabel(item))}</td>
        <td>${escapeHtml(item.color_code)}</td>
        <td>${escapeHtml(item.color_name)}</td>
        <td>${qtyMain}</td>
        <td>${qtyRolls}</td>
        <td>${escapeHtml(r.note || "")}</td>
        <td>
          <div class="actionsRow">
            <button class="secondary" data-act="edit" data-id="${r.id}">تعديل</button>
            <button class="danger" data-act="delete" data-id="${r.id}">حذف</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  setMsg(msg, `تم التحميل: ${rows.length} حركة`, true);
}

$("btnReload").addEventListener("click", loadMoves);
$("search").addEventListener("input", () => { clearTimeout(window.__t2); window.__t2 = setTimeout(loadMoves, 250); });
$("from").addEventListener("change", loadMoves);
$("to").addEventListener("change", loadMoves);

$("btnCancel").addEventListener("click", () => {
  $("editId").value = "";
  $("moveForm").reset();
  $("move_date").value = todayISO();
  refreshUnitHint();
  setMsg(msg, "تم إلغاء التعديل", true);
});

$("moveForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const err = validate();
  if(err) return setMsg(msg, err, false);

  setMsg(msg, "جارٍ الحفظ...", true);

  const qtyMain = Number($("qty_main").value);
  const qtyRolls = Number($("qty_rolls").value);

  const payload = {
    type: MOVE_TYPE,
    move_date: $("move_date").value,
    item_id: itemSelect.value,
    note: cleanText($("note").value) || null,
    qty_main_in: 0,
    qty_main_out: 0,
    qty_rolls_in: 0,
    qty_rolls_out: 0
  };

  if(MOVE_TYPE === "purchase"){
    payload.qty_main_in = qtyMain;
    payload.qty_rolls_in = qtyRolls;
  }else if(MOVE_TYPE === "sale"){
    payload.qty_main_out = qtyMain;
    payload.qty_rolls_out = qtyRolls;
  }

  try{
    const editId = $("editId").value || null;
    if(!editId){
      const { error } = await supabase.from("stock_moves").insert([payload]);
      if(error) throw error;
    }else{
      const { error } = await supabase.from("stock_moves").update(payload).eq("id", editId);
      if(error) throw error;
    }

    $("editId").value = "";
    $("moveForm").reset();
    $("move_date").value = todayISO();
    refreshUnitHint();
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
    itemSelect.value = data.item_id;
    refreshUnitHint();

    const qtyMain = (data.qty_main_in || 0) + (data.qty_main_out || 0);
    const qtyRolls = (data.qty_rolls_in || 0) + (data.qty_rolls_out || 0);
    $("qty_main").value = qtyMain || "";
    $("qty_rolls").value = qtyRolls || "";
    $("note").value = data.note || "";

    setMsg(msg, "وضع التعديل مفعل — عدّل ثم احفظ", true);
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

  await (async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await loadItems(); })();
  $("move_date").value = todayISO();
  refreshUnitHint();
  await loadMoves();
})();