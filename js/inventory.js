import { supabase } from "./supabaseClient.js";
import { $, escapeHtml, setMsg, materialLabel, getPublicImageUrl, unitLabel, daysSince, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const msg = $("msg");
if(keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)){
  setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("tbody");

async function fetchItems(){
  const scope = $("scope").value;
  let q = supabase.from("items").select("*")
    .order("main_category").order("sub_category").order("item_name").order("color_code");
  if(scope === "active") q = q.eq("is_active", true);
  const { data, error } = await q;
  if(error) throw error;
  return data || [];
}

async function fetchMovesForItems(itemIds){
  if(itemIds.length === 0) return [];
  const all = [];
  const chunkSize = 200;
  for(let i=0; i<itemIds.length; i+=chunkSize){
    const chunk = itemIds.slice(i,i+chunkSize);
    const { data, error } = await supabase
      .from("stock_moves")
      .select("item_id, type, move_date, qty_main_in, qty_main_out, qty_rolls_in, qty_rolls_out")
      .in("item_id", chunk);
    if(error) throw error;
    all.push(...(data||[]));
  }
  return all;
}

function applyPreset(rows, preset){
  const byText = (a,b) => (a||"").localeCompare(b||"", "ar");
  const byNum = (a,b) => (a??0) - (b??0);

  if(preset === "default"){
    rows.sort((x,y) =>
      byText(x.main_category,y.main_category) ||
      byText(x.sub_category,y.sub_category) ||
      byText(x.item_name,y.item_name) ||
      byText(x.color_code,y.color_code)
    );
    return;
  }

  if(preset === "most_qty_in_item"){
    rows.sort((x,y) =>
      byText(x.main_category,y.main_category) ||
      byText(x.sub_category,y.sub_category) ||
      byText(x.item_name,y.item_name) ||
      (byNum(y.balance_main, x.balance_main)) ||
      byText(x.color_code,y.color_code)
    );
    return;
  }

  if(preset === "stale"){
    rows.sort((x,y) => (y.days_since_sale ?? -1) - (x.days_since_sale ?? -1));
    return;
  }

  if(preset === "latest_sale"){
    rows.sort((x,y) => (x.last_sale_date||"").localeCompare(y.last_sale_date||""));
    rows.reverse();
    return;
  }

  if(preset === "most_rolls"){
    rows.sort((x,y) => (y.balance_rolls ?? 0) - (x.balance_rolls ?? 0));
    return;
  }
}

async function load(){
  setMsg(msg, "تحميل...", true);
  tbody.innerHTML = "";

  const q = $("search").value.trim().toLowerCase();
  const preset = $("preset").value;
  const onlyStale = $("onlyStale").checked;

  try{
    const items = await fetchItems();
    const moves = await fetchMovesForItems(items.map(i=>i.id));

    const agg = new Map();
    for(const it of items){
      agg.set(it.id, { ...it, balance_main: 0, balance_rolls: 0, last_sale_date: null });
    }

    for(const m of moves){
      const r = agg.get(m.item_id);
      if(!r) continue;
      r.balance_main += (m.qty_main_in||0) - (m.qty_main_out||0);
      r.balance_rolls += (m.qty_rolls_in||0) - (m.qty_rolls_out||0);

      // آخر مبيعات فقط (لا adjustment)
      if(m.type === "sale"){
        if(!r.last_sale_date || m.move_date > r.last_sale_date) r.last_sale_date = m.move_date;
      }
    }

    let rows = [...agg.values()].map(r => ({ ...r, days_since_sale: daysSince(r.last_sale_date) }));

    if(q){
      rows = rows.filter(r => {
        const hay = `${materialLabel(r)} ${r.color_code} ${r.color_name} ${r.description||""}`.toLowerCase();
        return hay.includes(q);
      });
    }

    if(onlyStale){
      rows = rows.filter(r => (r.days_since_sale ?? 999999) >= 30);
    }

    applyPreset(rows, preset);

    tbody.innerHTML = rows.map(r => {
      const imgUrl = getPublicImageUrl(r.image_path);
      const img = imgUrl ? `<img class="thumb" src="${imgUrl}" alt="img" />` : `<span class="thumb"></span>`;
      const days = r.days_since_sale;

      let badge = "";
      if(days === null) badge = '<span class="badge warn">بدون مبيعات</span>';
      else if(days <= 7) badge = '<span class="badge ok">طبيعي</span>';
      else if(days <= 30) badge = '<span class="badge warn">انتباه</span>';
      else badge = '<span class="badge danger">راكد</span>';

      return `
        <tr>
          <td>${img}</td>
          <td>${escapeHtml(materialLabel(r))}</td>
          <td>${escapeHtml(r.color_code)}</td>
          <td>${escapeHtml(r.color_name)}</td>
          <td>${Number(r.balance_main||0).toFixed(3)} ${escapeHtml(unitLabel(r.unit_type))}</td>
          <td>${parseInt(r.balance_rolls||0,10)}</td>
          <td>${escapeHtml(r.last_sale_date || "-")} ${badge}</td>
          <td>${days === null ? "-" : days}</td>
        </tr>
      `;
    }).join("");

    setMsg(msg, `تم التحميل: ${rows.length} مادة`, true);
  }catch(ex){
    setMsg(msg, explainSupabaseError(ex), false);
  }
}

$("btnReload").addEventListener("click", load);
$("search").addEventListener("input", () => { clearTimeout(window.__ti); window.__ti = setTimeout(load, 250); });
$("scope").addEventListener("change", load);
$("preset").addEventListener("change", load);
$("onlyStale").addEventListener("change", load);

(async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await load(); })();