import { supabase } from "./supabaseClient.js";
import { $, cleanText, normalizeArabicDigits, escapeHtml, setMsg, materialLabel, getPublicImageUrl, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const msg = $("msg");
if(keysLookUnchanged(SUPABASE_URL, SUPABASE_ANON_KEY)){
  setMsg(msg, "مفاتيح Supabase غير مُعدلة بعد. افتح js/supabaseClient.js وضع Project URL و Publishable Key.", false);
}

const tbody = $("itemsTbody");
const mainList = $("mainList");
const subList = $("subList");
const nameList = $("nameList");

function rowStatusBadge(isActive){
  return isActive ? '<span class="badge ok">نشط</span>' : '<span class="badge warn">موقوف</span>';
}

async function loadItems(){
  setMsg(msg, "تحميل...", true);
  tbody.innerHTML = "";
  mainList.innerHTML = ""; subList.innerHTML = ""; nameList.innerHTML = "";

  const showAll = $("showAll").checked;
  const q = $("search").value.trim();

  let query = supabase.from("items").select("*").order("created_at", { ascending: false });
  if(!showAll) query = query.eq("is_active", true);

  if(q){
    query = query.or(
      `main_category.ilike.%${q}%,sub_category.ilike.%${q}%,item_name.ilike.%${q}%,color_code.ilike.%${q}%,color_name.ilike.%${q}%,description.ilike.%${q}%`
    );
  }

  const { data, error } = await query;
  if(error){ setMsg(msg, explainSupabaseError(error), false); return; }

  const mains = new Set(), subs = new Set(), names = new Set();
  for(const r of (data||[])){
    if(r.main_category) mains.add(r.main_category);
    if(r.sub_category) subs.add(r.sub_category);
    if(r.item_name) names.add(r.item_name);
  }
  mainList.innerHTML = [...mains].sort().map(v=>`<option value="${escapeHtml(v)}"></option>`).join("");
  subList.innerHTML  = [...subs].sort().map(v=>`<option value="${escapeHtml(v)}"></option>`).join("");
  nameList.innerHTML = [...names].sort().map(v=>`<option value="${escapeHtml(v)}"></option>`).join("");

  tbody.innerHTML = (data||[]).map(r => {
    const imgUrl = getPublicImageUrl(r.image_path);
    const img = imgUrl ? `<img class="thumb" src="${imgUrl}" alt="img" />` : `<span class="thumb"></span>`;
    const desc = escapeHtml(r.description ?? "");
    return `
      <tr>
        <td>${img}</td>
        <td>${escapeHtml(materialLabel(r))}</td>
        <td>${escapeHtml(r.color_code)}</td>
        <td>${escapeHtml(r.color_name)}</td>
        <td>${escapeHtml(r.unit_type)}</td>
        <td>${desc}</td>
        <td>${rowStatusBadge(r.is_active)}</td>
        <td>
          <div class="actionsRow">
            <button class="secondary" data-act="edit" data-id="${r.id}">تعديل</button>
            ${r.is_active
              ? `<button class="secondary" data-act="deactivate" data-id="${r.id}">إيقاف</button>`
              : `<button class="secondary" data-act="activate" data-id="${r.id}">تفعيل</button>`
            }
            <button class="danger" data-act="delete" data-id="${r.id}">حذف</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  setMsg(msg, `تم التحميل: ${(data||[]).length} مادة`, true);
}

async function uploadImageIfAny(itemId){
  const file = $("image_file").files?.[0];
  if(!file) return null;

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g,"");
  const path = `items/${itemId}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("item-images")
    .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });

  if(upErr) throw upErr;
  return path;
}

$("btnReload").addEventListener("click", loadItems);
$("search").addEventListener("input", () => { clearTimeout(window.__t); window.__t = setTimeout(loadItems, 250); });
$("showAll").addEventListener("change", loadItems);

$("btnCancel").addEventListener("click", () => {
  $("editId").value = "";
  $("itemForm").reset();
  setMsg(msg, "تم إلغاء التعديل", true);
});

$("itemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg(msg, "جارٍ الحفظ...", true);

  const payload = {
    main_category: cleanText($("main_category").value),
    sub_category:  cleanText($("sub_category").value),
    item_name:     cleanText($("item_name").value),
    color_code:    normalizeArabicDigits(cleanText($("color_code").value)),
    color_name:    cleanText($("color_name").value),
    unit_type:     $("unit_type").value,
    description:   cleanText($("description").value) || null,
  };

  try{
    const editId = $("editId").value || null;

    let itemId = editId;
    if(!editId){
      const { data, error } = await supabase.from("items").insert([payload]).select("id").single();
      if(error) throw error;
      itemId = data.id;
    }else{
      const { error } = await supabase.from("items").update(payload).eq("id", editId);
      if(error) throw error;
    }

    const image_path = await uploadImageIfAny(itemId);
    if(image_path){
      const { error } = await supabase.from("items").update({ image_path }).eq("id", itemId);
      if(error) throw error;
    }

    $("editId").value = "";
    $("itemForm").reset();
    setMsg(msg, "تم الحفظ", true);
    await 
// ===== Bulk Add (Paste multiple items) =====
const bulkModal = document.getElementById("bulkModal");
const bulkMsg = document.getElementById("bulkMsg");
const bulkTbody = document.getElementById("bulkTbody");
const bulkText = document.getElementById("bulkText");

function openBulk(){ if(bulkModal) bulkModal.style.display = "flex"; }
function closeBulk(){ if(bulkModal) bulkModal.style.display = "none"; }

function parseBulkLines(text){
  const lines = String(text||"").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for(let i=0;i<lines.length;i++){
    const raw = lines[i];
    const parts = raw.split("|").map(p => p.trim());
    if(parts.length < 6){
      out.push({ idx:i+1, raw, ok:false, reason:"صيغة غير صحيحة (اقل من 6 حقول)" });
      continue;
    }
    const [main_category, sub_category, item_name, color_code_raw, color_name, unit_raw] = parts;
    const description = parts.slice(6).join(" | ").trim() || null;

    const color_code = normalizeArabicDigits(cleanText(color_code_raw));
    const unit_type = unit_raw.toLowerCase();
    if(!main_category || !sub_category || !item_name || !color_code || !color_name || !unit_type){
      out.push({ idx:i+1, raw, ok:false, reason:"حقول ناقصة" });
      continue;
    }
    if(unit_type !== "kg" && unit_type !== "m"){
      out.push({ idx:i+1, raw, ok:false, reason:"الوحدة يجب أن تكون kg أو m" });
      continue;
    }
    out.push({
      idx:i+1,
      raw,
      ok:true,
      data: {
        main_category: cleanText(main_category),
        sub_category: cleanText(sub_category),
        item_name: cleanText(item_name),
        color_code,
        color_name: cleanText(color_name),
        unit_type,
        description: description ? cleanText(description) : null
      }
    });
  }
  return out;
}

function keyOf(d){
  return `${d.main_category}|||${d.sub_category}|||${d.item_name}|||${d.color_code}`.toLowerCase();
}

async function fetchExistingKeys(candidates){
  const mains = [...new Set(candidates.map(x=>x.main_category))];
  const subs  = [...new Set(candidates.map(x=>x.sub_category))];
  const names = [...new Set(candidates.map(x=>x.item_name))];
  const codes = [...new Set(candidates.map(x=>x.color_code))];

  const { data, error } = await supabase
    .from("items")
    .select("main_category, sub_category, item_name, color_code")
    .in("main_category", mains)
    .in("sub_category", subs)
    .in("item_name", names)
    .in("color_code", codes);

  if(error) throw error;

  const set = new Set();
  for(const r of (data||[])){
    set.add(`${r.main_category}|||${r.sub_category}|||${r.item_name}|||${r.color_code}`.toLowerCase());
  }
  return set;
}

function renderBulkPreview(parsed, existingKeySet){
  if(!bulkTbody) return;
  bulkTbody.innerHTML = parsed.map(p => {
    if(!p.ok){
      return `<tr>
        <td>${p.idx}</td>
        <td><span class="badge danger">خطأ</span> ${escapeHtml(p.reason)}</td>
        <td colspan="5"><code style="unicode-bidi: plaintext;">${escapeHtml(p.raw)}</code></td>
      </tr>`;
    }

    const d = p.data;
    const k = keyOf(d);
    const isDup = existingKeySet?.has(k);
    const status = isDup ? `<span class="badge warn">موجود</span> تخطي` : `<span class="badge ok">جديد</span>`;

    return `<tr>
      <td>${p.idx}</td>
      <td>${status}</td>
      <td>${escapeHtml(materialLabel(d))}</td>
      <td>${escapeHtml(d.color_code)}</td>
      <td>${escapeHtml(d.color_name)}</td>
      <td>${escapeHtml(d.unit_type)}</td>
      <td>${escapeHtml(d.description || "")}</td>
    </tr>`;
  }).join("");
}

async function bulkPreview(){
  setMsg(bulkMsg, "جارٍ التحضير...", true);

  const parsed = parseBulkLines(bulkText?.value || "");
  const okOnes = parsed.filter(x=>x.ok).map(x=>x.data);

  // remove duplicates inside paste
  const seen = new Set();
  const uniqueCandidates = [];
  for(const d of okOnes){
    const k = keyOf(d);
    if(seen.has(k)) continue;
    seen.add(k);
    uniqueCandidates.push(d);
  }

  let existing = new Set();
  if(uniqueCandidates.length){
    existing = await fetchExistingKeys(uniqueCandidates);
  }

  renderBulkPreview(parsed, existing);

  const total = parsed.length;
  const bad = parsed.filter(x=>!x.ok).length;
  const dupExisting = uniqueCandidates.filter(d => existing.has(keyOf(d))).length;
  const newCount = uniqueCandidates.length - dupExisting;

  setMsg(bulkMsg, `إجمالي ${total} سطر — أخطاء: ${bad} — جديد: ${newCount} — موجود (سيُتخطى): ${dupExisting}`, true);
  return { parsed, uniqueCandidates, existing };
}

async function bulkApply(){
  const ok = await testSupabaseConnection(bulkMsg);
  if(!ok) return;

  const { uniqueCandidates, existing } = await bulkPreview();
  const toInsert = uniqueCandidates.filter(d => !existing.has(keyOf(d)));

  if(toInsert.length === 0){
    return setMsg(bulkMsg, "لا يوجد مواد جديدة للحفظ (كلها موجودة أو بها أخطاء).", false);
  }

  setMsg(bulkMsg, `جارٍ الحفظ (${toInsert.length})...`, true);

  const chunkSize = 200;
  let inserted = 0;
  for(let i=0;i<toInsert.length;i+=chunkSize){
    const chunk = toInsert.slice(i,i+chunkSize);
    const { error } = await supabase.from("items").insert(chunk);
    if(error){
      const msgErr = explainSupabaseError(error);
      setMsg(bulkMsg, `تعذر حفظ دفعة. سنحاول صف-صف. (${msgErr})`, false);

      for(const row of chunk){
        const { error: e2 } = await supabase.from("items").insert([row]);
        if(!e2) inserted += 1;
      }
    }else{
      inserted += chunk.length;
    }
  }

  setMsg(bulkMsg, `تم الحفظ. تمت إضافة: ${inserted} مادة.`, true);
  await loadItems();
}

document.getElementById("btnBulk")?.addEventListener("click", openBulk);
document.getElementById("bulkClose")?.addEventListener("click", closeBulk);
bulkModal?.addEventListener("click", (e) => { if(e.target === bulkModal) closeBulk(); });

document.getElementById("bulkPreview")?.addEventListener("click", async () => {
  try{ await bulkPreview(); }catch(ex){ setMsg(bulkMsg, explainSupabaseError(ex), false); }
});
document.getElementById("bulkApply")?.addEventListener("click", async () => {
  try{ await bulkApply(); }catch(ex){ setMsg(bulkMsg, explainSupabaseError(ex), false); }
});
document.getElementById("bulkClear")?.addEventListener("click", () => {
  if(bulkText) bulkText.value = "";
  if(bulkTbody) bulkTbody.innerHTML = "";
  setMsg(bulkMsg, "تم المسح", true);
});


(async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await loadItems(); })();
  }catch(err){
    setMsg(msg, explainSupabaseError(err), false);
  }
});

tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if(!btn) return;

  const act = btn.dataset.act;
  const id = btn.dataset.id;

  if(act === "edit"){
    const { data, error } = await supabase.from("items").select("*").eq("id", id).single();
    if(error) return setMsg(msg, explainSupabaseError(error), false);

    $("editId").value = data.id;
    $("main_category").value = data.main_category || "";
    $("sub_category").value  = data.sub_category || "";
    $("item_name").value     = data.item_name || "";
    $("color_code").value    = data.color_code || "";
    $("color_name").value    = data.color_name || "";
    $("unit_type").value     = data.unit_type || "";
    $("description").value   = data.description || "";
    $("image_file").value    = "";
    setMsg(msg, "وضع التعديل مفعل — عدّل ثم اضغط حفظ", true);
    return;
  }

  if(act === "activate" || act === "deactivate"){
    const is_active = act === "activate";
    const { error } = await supabase.from("items").update({ is_active }).eq("id", id);
    if(error) return setMsg(msg, explainSupabaseError(error), false);
    await 
// ===== Bulk Add (Paste multiple items) =====
const bulkModal = document.getElementById("bulkModal");
const bulkMsg = document.getElementById("bulkMsg");
const bulkTbody = document.getElementById("bulkTbody");
const bulkText = document.getElementById("bulkText");

function openBulk(){ if(bulkModal) bulkModal.style.display = "flex"; }
function closeBulk(){ if(bulkModal) bulkModal.style.display = "none"; }

function parseBulkLines(text){
  const lines = String(text||"").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for(let i=0;i<lines.length;i++){
    const raw = lines[i];
    const parts = raw.split("|").map(p => p.trim());
    if(parts.length < 6){
      out.push({ idx:i+1, raw, ok:false, reason:"صيغة غير صحيحة (اقل من 6 حقول)" });
      continue;
    }
    const [main_category, sub_category, item_name, color_code_raw, color_name, unit_raw] = parts;
    const description = parts.slice(6).join(" | ").trim() || null;

    const color_code = normalizeArabicDigits(cleanText(color_code_raw));
    const unit_type = unit_raw.toLowerCase();
    if(!main_category || !sub_category || !item_name || !color_code || !color_name || !unit_type){
      out.push({ idx:i+1, raw, ok:false, reason:"حقول ناقصة" });
      continue;
    }
    if(unit_type !== "kg" && unit_type !== "m"){
      out.push({ idx:i+1, raw, ok:false, reason:"الوحدة يجب أن تكون kg أو m" });
      continue;
    }
    out.push({
      idx:i+1,
      raw,
      ok:true,
      data: {
        main_category: cleanText(main_category),
        sub_category: cleanText(sub_category),
        item_name: cleanText(item_name),
        color_code,
        color_name: cleanText(color_name),
        unit_type,
        description: description ? cleanText(description) : null
      }
    });
  }
  return out;
}

function keyOf(d){
  return `${d.main_category}|||${d.sub_category}|||${d.item_name}|||${d.color_code}`.toLowerCase();
}

async function fetchExistingKeys(candidates){
  const mains = [...new Set(candidates.map(x=>x.main_category))];
  const subs  = [...new Set(candidates.map(x=>x.sub_category))];
  const names = [...new Set(candidates.map(x=>x.item_name))];
  const codes = [...new Set(candidates.map(x=>x.color_code))];

  const { data, error } = await supabase
    .from("items")
    .select("main_category, sub_category, item_name, color_code")
    .in("main_category", mains)
    .in("sub_category", subs)
    .in("item_name", names)
    .in("color_code", codes);

  if(error) throw error;

  const set = new Set();
  for(const r of (data||[])){
    set.add(`${r.main_category}|||${r.sub_category}|||${r.item_name}|||${r.color_code}`.toLowerCase());
  }
  return set;
}

function renderBulkPreview(parsed, existingKeySet){
  if(!bulkTbody) return;
  bulkTbody.innerHTML = parsed.map(p => {
    if(!p.ok){
      return `<tr>
        <td>${p.idx}</td>
        <td><span class="badge danger">خطأ</span> ${escapeHtml(p.reason)}</td>
        <td colspan="5"><code style="unicode-bidi: plaintext;">${escapeHtml(p.raw)}</code></td>
      </tr>`;
    }

    const d = p.data;
    const k = keyOf(d);
    const isDup = existingKeySet?.has(k);
    const status = isDup ? `<span class="badge warn">موجود</span> تخطي` : `<span class="badge ok">جديد</span>`;

    return `<tr>
      <td>${p.idx}</td>
      <td>${status}</td>
      <td>${escapeHtml(materialLabel(d))}</td>
      <td>${escapeHtml(d.color_code)}</td>
      <td>${escapeHtml(d.color_name)}</td>
      <td>${escapeHtml(d.unit_type)}</td>
      <td>${escapeHtml(d.description || "")}</td>
    </tr>`;
  }).join("");
}

async function bulkPreview(){
  setMsg(bulkMsg, "جارٍ التحضير...", true);

  const parsed = parseBulkLines(bulkText?.value || "");
  const okOnes = parsed.filter(x=>x.ok).map(x=>x.data);

  // remove duplicates inside paste
  const seen = new Set();
  const uniqueCandidates = [];
  for(const d of okOnes){
    const k = keyOf(d);
    if(seen.has(k)) continue;
    seen.add(k);
    uniqueCandidates.push(d);
  }

  let existing = new Set();
  if(uniqueCandidates.length){
    existing = await fetchExistingKeys(uniqueCandidates);
  }

  renderBulkPreview(parsed, existing);

  const total = parsed.length;
  const bad = parsed.filter(x=>!x.ok).length;
  const dupExisting = uniqueCandidates.filter(d => existing.has(keyOf(d))).length;
  const newCount = uniqueCandidates.length - dupExisting;

  setMsg(bulkMsg, `إجمالي ${total} سطر — أخطاء: ${bad} — جديد: ${newCount} — موجود (سيُتخطى): ${dupExisting}`, true);
  return { parsed, uniqueCandidates, existing };
}

async function bulkApply(){
  const ok = await testSupabaseConnection(bulkMsg);
  if(!ok) return;

  const { uniqueCandidates, existing } = await bulkPreview();
  const toInsert = uniqueCandidates.filter(d => !existing.has(keyOf(d)));

  if(toInsert.length === 0){
    return setMsg(bulkMsg, "لا يوجد مواد جديدة للحفظ (كلها موجودة أو بها أخطاء).", false);
  }

  setMsg(bulkMsg, `جارٍ الحفظ (${toInsert.length})...`, true);

  const chunkSize = 200;
  let inserted = 0;
  for(let i=0;i<toInsert.length;i+=chunkSize){
    const chunk = toInsert.slice(i,i+chunkSize);
    const { error } = await supabase.from("items").insert(chunk);
    if(error){
      const msgErr = explainSupabaseError(error);
      setMsg(bulkMsg, `تعذر حفظ دفعة. سنحاول صف-صف. (${msgErr})`, false);

      for(const row of chunk){
        const { error: e2 } = await supabase.from("items").insert([row]);
        if(!e2) inserted += 1;
      }
    }else{
      inserted += chunk.length;
    }
  }

  setMsg(bulkMsg, `تم الحفظ. تمت إضافة: ${inserted} مادة.`, true);
  await loadItems();
}

document.getElementById("btnBulk")?.addEventListener("click", openBulk);
document.getElementById("bulkClose")?.addEventListener("click", closeBulk);
bulkModal?.addEventListener("click", (e) => { if(e.target === bulkModal) closeBulk(); });

document.getElementById("bulkPreview")?.addEventListener("click", async () => {
  try{ await bulkPreview(); }catch(ex){ setMsg(bulkMsg, explainSupabaseError(ex), false); }
});
document.getElementById("bulkApply")?.addEventListener("click", async () => {
  try{ await bulkApply(); }catch(ex){ setMsg(bulkMsg, explainSupabaseError(ex), false); }
});
document.getElementById("bulkClear")?.addEventListener("click", () => {
  if(bulkText) bulkText.value = "";
  if(bulkTbody) bulkTbody.innerHTML = "";
  setMsg(bulkMsg, "تم المسح", true);
});


(async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await loadItems(); })();
    return;
  }

  if(act === "delete"){
    if(!confirm("تأكيد الحذف النهائي؟")) return;
    const { error } = await supabase.from("items").delete().eq("id", id);
    if(error) return setMsg(msg, explainSupabaseError(error), false);
    await 
// ===== Bulk Add (Paste multiple items) =====
const bulkModal = document.getElementById("bulkModal");
const bulkMsg = document.getElementById("bulkMsg");
const bulkTbody = document.getElementById("bulkTbody");
const bulkText = document.getElementById("bulkText");

function openBulk(){ if(bulkModal) bulkModal.style.display = "flex"; }
function closeBulk(){ if(bulkModal) bulkModal.style.display = "none"; }

function parseBulkLines(text){
  const lines = String(text||"").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for(let i=0;i<lines.length;i++){
    const raw = lines[i];
    const parts = raw.split("|").map(p => p.trim());
    if(parts.length < 6){
      out.push({ idx:i+1, raw, ok:false, reason:"صيغة غير صحيحة (اقل من 6 حقول)" });
      continue;
    }
    const [main_category, sub_category, item_name, color_code_raw, color_name, unit_raw] = parts;
    const description = parts.slice(6).join(" | ").trim() || null;

    const color_code = normalizeArabicDigits(cleanText(color_code_raw));
    const unit_type = unit_raw.toLowerCase();
    if(!main_category || !sub_category || !item_name || !color_code || !color_name || !unit_type){
      out.push({ idx:i+1, raw, ok:false, reason:"حقول ناقصة" });
      continue;
    }
    if(unit_type !== "kg" && unit_type !== "m"){
      out.push({ idx:i+1, raw, ok:false, reason:"الوحدة يجب أن تكون kg أو m" });
      continue;
    }
    out.push({
      idx:i+1,
      raw,
      ok:true,
      data: {
        main_category: cleanText(main_category),
        sub_category: cleanText(sub_category),
        item_name: cleanText(item_name),
        color_code,
        color_name: cleanText(color_name),
        unit_type,
        description: description ? cleanText(description) : null
      }
    });
  }
  return out;
}

function keyOf(d){
  return `${d.main_category}|||${d.sub_category}|||${d.item_name}|||${d.color_code}`.toLowerCase();
}

async function fetchExistingKeys(candidates){
  const mains = [...new Set(candidates.map(x=>x.main_category))];
  const subs  = [...new Set(candidates.map(x=>x.sub_category))];
  const names = [...new Set(candidates.map(x=>x.item_name))];
  const codes = [...new Set(candidates.map(x=>x.color_code))];

  const { data, error } = await supabase
    .from("items")
    .select("main_category, sub_category, item_name, color_code")
    .in("main_category", mains)
    .in("sub_category", subs)
    .in("item_name", names)
    .in("color_code", codes);

  if(error) throw error;

  const set = new Set();
  for(const r of (data||[])){
    set.add(`${r.main_category}|||${r.sub_category}|||${r.item_name}|||${r.color_code}`.toLowerCase());
  }
  return set;
}

function renderBulkPreview(parsed, existingKeySet){
  if(!bulkTbody) return;
  bulkTbody.innerHTML = parsed.map(p => {
    if(!p.ok){
      return `<tr>
        <td>${p.idx}</td>
        <td><span class="badge danger">خطأ</span> ${escapeHtml(p.reason)}</td>
        <td colspan="5"><code style="unicode-bidi: plaintext;">${escapeHtml(p.raw)}</code></td>
      </tr>`;
    }

    const d = p.data;
    const k = keyOf(d);
    const isDup = existingKeySet?.has(k);
    const status = isDup ? `<span class="badge warn">موجود</span> تخطي` : `<span class="badge ok">جديد</span>`;

    return `<tr>
      <td>${p.idx}</td>
      <td>${status}</td>
      <td>${escapeHtml(materialLabel(d))}</td>
      <td>${escapeHtml(d.color_code)}</td>
      <td>${escapeHtml(d.color_name)}</td>
      <td>${escapeHtml(d.unit_type)}</td>
      <td>${escapeHtml(d.description || "")}</td>
    </tr>`;
  }).join("");
}

async function bulkPreview(){
  setMsg(bulkMsg, "جارٍ التحضير...", true);

  const parsed = parseBulkLines(bulkText?.value || "");
  const okOnes = parsed.filter(x=>x.ok).map(x=>x.data);

  // remove duplicates inside paste
  const seen = new Set();
  const uniqueCandidates = [];
  for(const d of okOnes){
    const k = keyOf(d);
    if(seen.has(k)) continue;
    seen.add(k);
    uniqueCandidates.push(d);
  }

  let existing = new Set();
  if(uniqueCandidates.length){
    existing = await fetchExistingKeys(uniqueCandidates);
  }

  renderBulkPreview(parsed, existing);

  const total = parsed.length;
  const bad = parsed.filter(x=>!x.ok).length;
  const dupExisting = uniqueCandidates.filter(d => existing.has(keyOf(d))).length;
  const newCount = uniqueCandidates.length - dupExisting;

  setMsg(bulkMsg, `إجمالي ${total} سطر — أخطاء: ${bad} — جديد: ${newCount} — موجود (سيُتخطى): ${dupExisting}`, true);
  return { parsed, uniqueCandidates, existing };
}

async function bulkApply(){
  const ok = await testSupabaseConnection(bulkMsg);
  if(!ok) return;

  const { uniqueCandidates, existing } = await bulkPreview();
  const toInsert = uniqueCandidates.filter(d => !existing.has(keyOf(d)));

  if(toInsert.length === 0){
    return setMsg(bulkMsg, "لا يوجد مواد جديدة للحفظ (كلها موجودة أو بها أخطاء).", false);
  }

  setMsg(bulkMsg, `جارٍ الحفظ (${toInsert.length})...`, true);

  const chunkSize = 200;
  let inserted = 0;
  for(let i=0;i<toInsert.length;i+=chunkSize){
    const chunk = toInsert.slice(i,i+chunkSize);
    const { error } = await supabase.from("items").insert(chunk);
    if(error){
      const msgErr = explainSupabaseError(error);
      setMsg(bulkMsg, `تعذر حفظ دفعة. سنحاول صف-صف. (${msgErr})`, false);

      for(const row of chunk){
        const { error: e2 } = await supabase.from("items").insert([row]);
        if(!e2) inserted += 1;
      }
    }else{
      inserted += chunk.length;
    }
  }

  setMsg(bulkMsg, `تم الحفظ. تمت إضافة: ${inserted} مادة.`, true);
  await loadItems();
}

document.getElementById("btnBulk")?.addEventListener("click", openBulk);
document.getElementById("bulkClose")?.addEventListener("click", closeBulk);
bulkModal?.addEventListener("click", (e) => { if(e.target === bulkModal) closeBulk(); });

document.getElementById("bulkPreview")?.addEventListener("click", async () => {
  try{ await bulkPreview(); }catch(ex){ setMsg(bulkMsg, explainSupabaseError(ex), false); }
});
document.getElementById("bulkApply")?.addEventListener("click", async () => {
  try{ await bulkApply(); }catch(ex){ setMsg(bulkMsg, explainSupabaseError(ex), false); }
});
document.getElementById("bulkClear")?.addEventListener("click", () => {
  if(bulkText) bulkText.value = "";
  if(bulkTbody) bulkTbody.innerHTML = "";
  setMsg(bulkMsg, "تم المسح", true);
});


(async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await loadItems(); })();
  }
});


// ===== Bulk Add (Paste multiple items) =====
const bulkModal = document.getElementById("bulkModal");
const bulkMsg = document.getElementById("bulkMsg");
const bulkTbody = document.getElementById("bulkTbody");
const bulkText = document.getElementById("bulkText");

function openBulk(){ if(bulkModal) bulkModal.style.display = "flex"; }
function closeBulk(){ if(bulkModal) bulkModal.style.display = "none"; }

function parseBulkLines(text){
  const lines = String(text||"").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for(let i=0;i<lines.length;i++){
    const raw = lines[i];
    const parts = raw.split("|").map(p => p.trim());
    if(parts.length < 6){
      out.push({ idx:i+1, raw, ok:false, reason:"صيغة غير صحيحة (اقل من 6 حقول)" });
      continue;
    }
    const [main_category, sub_category, item_name, color_code_raw, color_name, unit_raw] = parts;
    const description = parts.slice(6).join(" | ").trim() || null;

    const color_code = normalizeArabicDigits(cleanText(color_code_raw));
    const unit_type = unit_raw.toLowerCase();
    if(!main_category || !sub_category || !item_name || !color_code || !color_name || !unit_type){
      out.push({ idx:i+1, raw, ok:false, reason:"حقول ناقصة" });
      continue;
    }
    if(unit_type !== "kg" && unit_type !== "m"){
      out.push({ idx:i+1, raw, ok:false, reason:"الوحدة يجب أن تكون kg أو m" });
      continue;
    }
    out.push({
      idx:i+1,
      raw,
      ok:true,
      data: {
        main_category: cleanText(main_category),
        sub_category: cleanText(sub_category),
        item_name: cleanText(item_name),
        color_code,
        color_name: cleanText(color_name),
        unit_type,
        description: description ? cleanText(description) : null
      }
    });
  }
  return out;
}

function keyOf(d){
  return `${d.main_category}|||${d.sub_category}|||${d.item_name}|||${d.color_code}`.toLowerCase();
}

async function fetchExistingKeys(candidates){
  const mains = [...new Set(candidates.map(x=>x.main_category))];
  const subs  = [...new Set(candidates.map(x=>x.sub_category))];
  const names = [...new Set(candidates.map(x=>x.item_name))];
  const codes = [...new Set(candidates.map(x=>x.color_code))];

  const { data, error } = await supabase
    .from("items")
    .select("main_category, sub_category, item_name, color_code")
    .in("main_category", mains)
    .in("sub_category", subs)
    .in("item_name", names)
    .in("color_code", codes);

  if(error) throw error;

  const set = new Set();
  for(const r of (data||[])){
    set.add(`${r.main_category}|||${r.sub_category}|||${r.item_name}|||${r.color_code}`.toLowerCase());
  }
  return set;
}

function renderBulkPreview(parsed, existingKeySet){
  if(!bulkTbody) return;
  bulkTbody.innerHTML = parsed.map(p => {
    if(!p.ok){
      return `<tr>
        <td>${p.idx}</td>
        <td><span class="badge danger">خطأ</span> ${escapeHtml(p.reason)}</td>
        <td colspan="5"><code style="unicode-bidi: plaintext;">${escapeHtml(p.raw)}</code></td>
      </tr>`;
    }

    const d = p.data;
    const k = keyOf(d);
    const isDup = existingKeySet?.has(k);
    const status = isDup ? `<span class="badge warn">موجود</span> تخطي` : `<span class="badge ok">جديد</span>`;

    return `<tr>
      <td>${p.idx}</td>
      <td>${status}</td>
      <td>${escapeHtml(materialLabel(d))}</td>
      <td>${escapeHtml(d.color_code)}</td>
      <td>${escapeHtml(d.color_name)}</td>
      <td>${escapeHtml(d.unit_type)}</td>
      <td>${escapeHtml(d.description || "")}</td>
    </tr>`;
  }).join("");
}

async function bulkPreview(){
  setMsg(bulkMsg, "جارٍ التحضير...", true);

  const parsed = parseBulkLines(bulkText?.value || "");
  const okOnes = parsed.filter(x=>x.ok).map(x=>x.data);

  // remove duplicates inside paste
  const seen = new Set();
  const uniqueCandidates = [];
  for(const d of okOnes){
    const k = keyOf(d);
    if(seen.has(k)) continue;
    seen.add(k);
    uniqueCandidates.push(d);
  }

  let existing = new Set();
  if(uniqueCandidates.length){
    existing = await fetchExistingKeys(uniqueCandidates);
  }

  renderBulkPreview(parsed, existing);

  const total = parsed.length;
  const bad = parsed.filter(x=>!x.ok).length;
  const dupExisting = uniqueCandidates.filter(d => existing.has(keyOf(d))).length;
  const newCount = uniqueCandidates.length - dupExisting;

  setMsg(bulkMsg, `إجمالي ${total} سطر — أخطاء: ${bad} — جديد: ${newCount} — موجود (سيُتخطى): ${dupExisting}`, true);
  return { parsed, uniqueCandidates, existing };
}

async function bulkApply(){
  const ok = await testSupabaseConnection(bulkMsg);
  if(!ok) return;

  const { uniqueCandidates, existing } = await bulkPreview();
  const toInsert = uniqueCandidates.filter(d => !existing.has(keyOf(d)));

  if(toInsert.length === 0){
    return setMsg(bulkMsg, "لا يوجد مواد جديدة للحفظ (كلها موجودة أو بها أخطاء).", false);
  }

  setMsg(bulkMsg, `جارٍ الحفظ (${toInsert.length})...`, true);

  const chunkSize = 200;
  let inserted = 0;
  for(let i=0;i<toInsert.length;i+=chunkSize){
    const chunk = toInsert.slice(i,i+chunkSize);
    const { error } = await supabase.from("items").insert(chunk);
    if(error){
      const msgErr = explainSupabaseError(error);
      setMsg(bulkMsg, `تعذر حفظ دفعة. سنحاول صف-صف. (${msgErr})`, false);

      for(const row of chunk){
        const { error: e2 } = await supabase.from("items").insert([row]);
        if(!e2) inserted += 1;
      }
    }else{
      inserted += chunk.length;
    }
  }

  setMsg(bulkMsg, `تم الحفظ. تمت إضافة: ${inserted} مادة.`, true);
  await loadItems();
}

document.getElementById("btnBulk")?.addEventListener("click", openBulk);
document.getElementById("bulkClose")?.addEventListener("click", closeBulk);
bulkModal?.addEventListener("click", (e) => { if(e.target === bulkModal) closeBulk(); });

document.getElementById("bulkPreview")?.addEventListener("click", async () => {
  try{ await bulkPreview(); }catch(ex){ setMsg(bulkMsg, explainSupabaseError(ex), false); }
});
document.getElementById("bulkApply")?.addEventListener("click", async () => {
  try{ await bulkApply(); }catch(ex){ setMsg(bulkMsg, explainSupabaseError(ex), false); }
});
document.getElementById("bulkClear")?.addEventListener("click", () => {
  if(bulkText) bulkText.value = "";
  if(bulkTbody) bulkTbody.innerHTML = "";
  setMsg(bulkMsg, "تم المسح", true);
});


(async()=>{ const ok = await testSupabaseConnection(msg); if(ok) await loadItems(); })();