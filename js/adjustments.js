import { supabase } from "./supabaseClient.js";
import { $, escapeHtml, materialLabel, setMsg, unitLabel, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const msg = $("msg");
if(keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)){
  setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("tbody");
const detailsCard = $("detailsCard");
const detailsBody = $("details");

async function load(){
  setMsg(msg, "تحميل...", true);
  tbody.innerHTML = "";
  detailsCard.style.display = "none";
  detailsBody.innerHTML = "";

  const from = $("from").value;
  const to = $("to").value;

  let q = supabase.from("recon_sessions").select("id, recon_date, created_at").order("recon_date", { ascending: false });
  if(from) q = q.gte("recon_date", from);
  if(to) q = q.lte("recon_date", to);

  const { data, error } = await q;
  if(error){ setMsg(msg, explainSupabaseError(error), false); return; }

  const ids = (data||[]).map(s=>s.id);
  const counts = new Map();
  if(ids.length){
    const { data: lines, error: lErr } = await supabase.from("recon_lines").select("session_id").in("session_id", ids);
    if(lErr){ setMsg(msg, lErr.message, false); return; }
    for(const l of lines||[]) counts.set(l.session_id, (counts.get(l.session_id)||0)+1);
  }

  tbody.innerHTML = (data||[]).map(s => `
    <tr>
      <td>${escapeHtml(s.recon_date)}</td>
      <td>${counts.get(s.id) || 0}</td>
      <td><button class="secondary" data-id="${s.id}">عرض</button></td>
    </tr>
  `).join("");

  setMsg(msg, `تم التحميل: ${(data||[]).length} جلسة`, true);
}

tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-id]");
  if(!btn) return;

  const id = btn.dataset.id;
  setMsg(msg, "تحميل التفاصيل...", true);

  const { data, error } = await supabase
    .from("recon_lines")
    .select("*, items:items(*)")
    .eq("session_id", id)
    .order("created_at", { ascending: true });

  if(error){ setMsg(msg, explainSupabaseError(error), false); return; }

  detailsBody.innerHTML = (data||[]).map(r => {
    const it = r.items;
    return `
      <tr>
        <td>${escapeHtml(materialLabel(it))}</td>
        <td>${escapeHtml(it.color_code)} / ${escapeHtml(it.color_name)}</td>
        <td>${Number(r.book_qty_main).toFixed(3)} ${escapeHtml(unitLabel(it.unit_type))} / ${r.book_qty_rolls} طبة</td>
        <td>${Number(r.actual_qty_main).toFixed(3)} ${escapeHtml(unitLabel(it.unit_type))} / ${r.actual_qty_rolls} طبة</td>
        <td>${Number(r.diff_qty_main).toFixed(3)} ${escapeHtml(unitLabel(it.unit_type))} / ${r.diff_qty_rolls} طبة</td>
      </tr>
    `;
  }).join("");

  detailsCard.style.display = "block";
  setMsg(msg, `تم التحميل: ${(data||[]).length} بند`, true);
});

$("btnReload").addEventListener("click", load);

(async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await load(); })();