import { supabase } from "./supabaseClient.js";
import { $, escapeHtml, setMsg, materialLabel, todayISO, unitLabel, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const msg = $("msg");
if(keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)){
  setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("tbody");
let stateRows = [];

async function fetchItems(scope){
  let q = supabase.from("items").select("*")
    .order("main_category").order("sub_category").order("item_name").order("color_code");
  if(scope === "active" || scope === "diff") q = q.eq("is_active", true);
  const { data, error } = await q;
  if(error) throw error;
  return data || [];
}

async function fetchMoves(itemIds){
  if(itemIds.length === 0) return [];
  const all = [];
  const chunkSize = 200;
  for(let i=0; i<itemIds.length; i+=chunkSize){
    const chunk = itemIds.slice(i,i+chunkSize);
    const { data, error } = await supabase
      .from("stock_moves")
      .select("item_id, qty_main_in, qty_main_out, qty_rolls_in, qty_rolls_out")
      .in("item_id", chunk);
    if(error) throw error;
    all.push(...(data||[]));
  }
  return all;
}

function computeDiff(r){
  if(r.actualMain === null || r.actualRolls === null) return null;
  return { dMain: (r.actualMain - r.balMain), dRolls: (r.actualRolls - r.balRolls) };
}

function render(scope){
  const rows = (scope === "diff")
    ? stateRows.filter(r => {
        const d = computeDiff(r);
        return d ? (d.dMain !== 0 || d.dRolls !== 0) : false;
      })
    : stateRows;

  tbody.innerHTML = rows.map(r => {
    const item = r.item;
    const d = computeDiff(r);
    const diffMain = d ? d.dMain : null;
    const diffRolls = d ? d.dRolls : null;

    return `
      <tr data-id="${item.id}">
        <td>${escapeHtml(materialLabel(item))}</td>
        <td>${escapeHtml(item.color_code)} / ${escapeHtml(item.color_name)}</td>
        <td>${r.balMain.toFixed(3)} ${escapeHtml(unitLabel(item.unit_type))}</td>
        <td>${r.balRolls}</td>
        <td><input class="aMain" type="number" step="0.001" min="0" value="${r.actualMain ?? ""}" placeholder="ادخل الفعلي"/></td>
        <td><input class="aRolls" type="number" step="1" min="0" value="${r.actualRolls ?? ""}" placeholder="ادخل الفعلي"/></td>
        <td>${diffMain === null ? "-" : diffMain.toFixed(3)}</td>
        <td>${diffRolls === null ? "-" : diffRolls}</td>
      </tr>
    `;
  }).join("");
}

async function load(){
  setMsg(msg, "تحميل...", true);
  const scope = $("scope").value;

  try{
    const items = await fetchItems(scope);
    const moves = await fetchMoves(items.map(i=>i.id));

    const agg = new Map();
    for(const it of items){
      agg.set(it.id, { item: it, balMain: 0, balRolls: 0, actualMain: null, actualRolls: null });
    }
    for(const m of moves){
      const r = agg.get(m.item_id);
      if(!r) continue;
      r.balMain += (m.qty_main_in||0) - (m.qty_main_out||0);
      r.balRolls += (m.qty_rolls_in||0) - (m.qty_rolls_out||0);
    }

    const prev = new Map(stateRows.map(r => [r.item.id, { actualMain: r.actualMain, actualRolls: r.actualRolls }]));
    stateRows = [...agg.values()].map(r => {
      const p = prev.get(r.item.id);
      if(p){ r.actualMain = p.actualMain; r.actualRolls = p.actualRolls; }
      return r;
    });

    render(scope);
    setMsg(msg, `تم التحميل: ${stateRows.length} مادة. أدخل الفعلي ثم اعتماد التسوية.`, true);
  }catch(ex){
    setMsg(msg, explainSupabaseError(ex), false);
  }
}

tbody.addEventListener("input", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if(!tr) return;

  const id = tr.dataset.id;
  const row = stateRows.find(x => x.item.id === id);
  if(!row) return;

  const aMain = tr.querySelector("input.aMain");
  const aRolls = tr.querySelector("input.aRolls");

  row.actualMain = aMain.value === "" ? null : Number(aMain.value);
  row.actualRolls = aRolls.value === "" ? null : Number(aRolls.value);
});

$("btnLoad").addEventListener("click", load);
$("scope").addEventListener("change", () => render($("scope").value));

$("btnSave").addEventListener("click", async () => {
  const reconDate = $("recon_date").value;
  if(!reconDate) return setMsg(msg, "اختر تاريخ التسوية", false);

  const lines = [];
  for(const r of stateRows){
    const hasAny = (r.actualMain !== null) || (r.actualRolls !== null);
    if(!hasAny) continue;
    if(r.actualMain === null || r.actualRolls === null) return setMsg(msg, "يجب إدخال الفعلي (رئيسية + أثواب) معاً لأي مادة", false);
    if(!Number.isInteger(r.actualRolls)) return setMsg(msg, "الأثواب الفعلية يجب أن تكون عدد صحيح", false);

    const diffMain = r.actualMain - r.balMain;
    const diffRolls = r.actualRolls - r.balRolls;

    if(diffMain === 0 && diffRolls === 0) continue;
    lines.push({ item_id: r.item.id, diffMain, diffRolls, balMain: r.balMain, balRolls: r.balRolls, actualMain: r.actualMain, actualRolls: r.actualRolls });
  }

  if(lines.length === 0) return setMsg(msg, "لا يوجد فروقات للحفظ (أو لم يتم إدخال فعلي).", false);

  setMsg(msg, "جارٍ اعتماد التسوية...", true);

  try{
    const { data: session, error: sErr } = await supabase
      .from("recon_sessions")
      .insert([{ recon_date: reconDate, note: null }])
      .select("id")
      .single();
    if(sErr) throw sErr;

    const sessionId = session.id;

    const reconLines = [];
    const adjMoves = [];

    for(const l of lines){
      reconLines.push({
        session_id: sessionId,
        recon_date: reconDate,
        item_id: l.item_id,
        book_qty_main: l.balMain,
        book_qty_rolls: l.balRolls,
        actual_qty_main: l.actualMain,
        actual_qty_rolls: l.actualRolls,
        diff_qty_main: l.diffMain,
        diff_qty_rolls: l.diffRolls
      });

      const mv = {
        type: "adjustment",
        move_date: reconDate,
        item_id: l.item_id,
        note: "تسوية جرد شهرية",
        qty_main_in: 0, qty_main_out: 0,
        qty_rolls_in: 0, qty_rolls_out: 0,
        session_id: sessionId
      };

      if(l.diffMain > 0) mv.qty_main_in = l.diffMain;
      if(l.diffMain < 0) mv.qty_main_out = Math.abs(l.diffMain);
      if(l.diffRolls > 0) mv.qty_rolls_in = l.diffRolls;
      if(l.diffRolls < 0) mv.qty_rolls_out = Math.abs(l.diffRolls);

      adjMoves.push(mv);
    }

    const { error: lErr } = await supabase.from("recon_lines").insert(reconLines);
    if(lErr) throw lErr;

    const { error: mErr } = await supabase.from("stock_moves").insert(adjMoves);
    if(mErr) throw mErr;

    setMsg(msg, `تم اعتماد التسوية. عدد المواد التي عليها فرق: ${lines.length}`, true);
    await (async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await load(); })();
  }catch(ex){
    setMsg(msg, explainSupabaseError(ex), false);
  }
});

(async () => {
  const ok = await testSupabaseConnection(msg);
  if(!ok) return;

  $("recon_date").value = todayISO();
  await (async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await load(); })();
})();