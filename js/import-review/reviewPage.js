import { $, escapeHtml, formatItemFullLabel, setMsg } from "../shared.js";
import { BATCH_STATUS, MATCH_STATUS } from "./constants.js";
import { createItemPicker } from "./itemPicker.js";
import { createBatchWithLines, deleteBatch, detectDuplicates, loadActiveItems, loadBatch, postReadyLines, recomputeBatchStats, runSmartValidation, updateLine } from "./batchService.js";
import { readXlsxFile } from "./fileParser.js";

function badge(status){
  if(status === MATCH_STATUS.EXACT) return '<span class="badge ok">مطابق تلقائي</span>';
  if(status === MATCH_STATUS.SUGGESTED) return '<span class="badge warn">مطابقة مقترحة</span>';
  if(status === MATCH_STATUS.MANUAL) return '<span class="badge ok">مطابقة يدوية</span>';
  if(status === MATCH_STATUS.DUPLICATE) return '<span class="badge danger">تحذير تكرار</span>';
  return '<span class="badge">غير معروف</span>';
}

function batchBadge(status){
  if(status === BATCH_STATUS.APPROVED) return '<span class="badge ok">معتمدة</span>';
  if(status === BATCH_STATUS.PARTIAL) return '<span class="badge warn">معتمدة جزئيًا</span>';
  if(status === BATCH_STATUS.CANCELLED) return '<span class="badge danger">ملغاة</span>';
  return '<span class="badge">Draft</span>';
}

export async function initReviewPage(batchType){
  const msg = $("msg");
  const url = new URL(location.href);
  let batchId = url.searchParams.get("batchId");
  let items = [];

  const state = { batch: null, lines: [] };

  async function refresh(){
    if(!batchId) return;
    const out = await loadBatch(batchId);
    state.batch = out.batch;
    state.lines = out.lines;
    render();
  }

  function lineItemLabel(line){
    if(line.matched_item) return formatItemFullLabel(line.matched_item);
    if(line.suggested_item) return formatItemFullLabel(line.suggested_item);
    return "—";
  }

  function summaryValue(id, v){ const el = $(id); if(el) el.textContent = String(v ?? 0); }

  function renderSummary(){
    const lines = state.lines;
    summaryValue("sumTotal", lines.length);
    summaryValue("sumExact", lines.filter(x => x.match_status === MATCH_STATUS.EXACT).length);
    summaryValue("sumSuggested", lines.filter(x => x.match_status === MATCH_STATUS.SUGGESTED).length);
    summaryValue("sumManual", lines.filter(x => x.match_status === MATCH_STATUS.MANUAL).length);
    summaryValue("sumUnknown", lines.filter(x => x.match_status === MATCH_STATUS.UNKNOWN).length);
    summaryValue("sumDup", lines.filter(x => x.match_status === MATCH_STATUS.DUPLICATE).length);
    summaryValue("sumExcluded", lines.filter(x => !x.is_included).length);
    summaryValue("sumPosted", lines.filter(x => x.is_posted).length);

    $("batchMeta").innerHTML = state.batch
      ? `رقم الحزمة: <strong>${escapeHtml(state.batch.batch_no)}</strong> | الحالة: ${batchBadge(state.batch.status)} | الملف: ${escapeHtml(state.batch.source_file_name)}`
      : "لم يتم تحميل حزمة بعد";
  }

  function render(){
    renderSummary();
    const tbody = $("tbody");
    tbody.innerHTML = state.lines.map(line => {
      const status = !line.is_included ? '<span class="badge">مستبعد</span>' : badge(line.match_status);
      const actions = [];
      if(line.match_status === MATCH_STATUS.SUGGESTED && !line.suggested_approved){
        actions.push(`<button class="secondary smallBtn" data-act="accept-suggest" data-id="${line.id}">اعتماد الاقتراح</button>`);
      }
      actions.push(`<button class="secondary smallBtn" data-act="pick" data-id="${line.id}">اختيار يدوي</button>`);
      actions.push(`<button class="danger smallBtn" data-act="toggle" data-id="${line.id}">${line.is_included ? "استبعاد" : "إعادة تضمين"}</button>`);
      if(line.match_status === MATCH_STATUS.DUPLICATE && !line.duplicate_approved){
        actions.push(`<button class="smallBtn" data-act="approve-dup" data-id="${line.id}">تمرير التحذير</button>`);
      }

      return `<tr>
        <td>${line.row_index}</td>
        <td>${escapeHtml(line.raw_item_name || "")}</td>
        <td>${escapeHtml(line.raw_color_code || "")}</td>
        <td>${escapeHtml(line.raw_color_name || "")}</td>
        <td>${line.raw_qty_primary ?? ""}</td>
        <td>${line.raw_rolls ?? ""}</td>
        <td>${escapeHtml(line.raw_date || "")}</td>
        <td>${status}</td>
        <td>${escapeHtml(lineItemLabel(line))}</td>
        <td>${line.match_score ?? "—"}</td>
        <td>${line.duplicate_warning_payload ? "⚠️" : "—"}</td>
        <td><div class="actionsRow">${actions.join("")}</div><div class="manualSlot" id="pick-${line.id}"></div></td>
      </tr>`;
    }).join("");
  }

  async function openManualPicker(lineId){
    const slot = document.getElementById(`pick-${lineId}`);
    if(!slot) return;
    slot.innerHTML = "";
    const picker = createItemPicker({
      items,
      onSelect: async (item) => {
        await updateLine(lineId, {
          matched_item_id: item.id,
          match_status: MATCH_STATUS.MANUAL,
          suggested_approved: false,
          duplicate_warning_payload: null,
          duplicate_approved: false,
        });
        await recomputeBatchStats(batchId);
        await refresh();
      }
    });
    slot.appendChild(picker);
  }

  $("tbody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if(!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;

    try{
      if(act === "accept-suggest"){
        const line = state.lines.find(x => x.id === id);
        if(!line?.suggested_item_id) return;
        await updateLine(id, { matched_item_id: line.suggested_item_id, suggested_approved: true, match_status: MATCH_STATUS.SUGGESTED });
      }else if(act === "toggle"){
        const line = state.lines.find(x => x.id === id);
        await updateLine(id, { is_included: !line.is_included });
      }else if(act === "approve-dup"){
        await updateLine(id, { duplicate_approved: true });
      }else if(act === "pick"){
        await openManualPicker(id);
        return;
      }
      await recomputeBatchStats(batchId);
      await refresh();
    }catch(err){ setMsg(msg, err.message || String(err), false); }
  });

  $("btnUpload").addEventListener("click", async () => {
    const f = $("importFile").files?.[0];
    if(!f) return setMsg(msg, "اختر ملف Excel أولاً", false);
    try{
      setMsg(msg, "جاري رفع الملف وتهيئة الحزمة...");
      const rows = await readXlsxFile(f);
      const out = await createBatchWithLines({ batchType, fileName: f.name, lines: rows, notes: $("batchNotes").value || null });
      batchId = out.batch.id;
      const u = new URL(location.href); u.searchParams.set("batchId", batchId); history.replaceState({}, "", u);
      await runSmartValidation(batchId, items);
      await refresh();
      setMsg(msg, "تم إنشاء الحزمة والتحقق الذكي بنجاح");
    }catch(err){ setMsg(msg, err.message || String(err), false); }
  });

  $("btnRecheck").addEventListener("click", async () => {
    if(!batchId) return;
    try{ await runSmartValidation(batchId, items); await refresh(); setMsg(msg, "تمت إعادة التحقق"); }
    catch(err){ setMsg(msg, err.message || String(err), false); }
  });

  $("btnDetectDup").addEventListener("click", async () => {
    if(!state.batch) return;
    try{ await detectDuplicates(state.batch); await recomputeBatchStats(batchId); await refresh(); setMsg(msg, "تم تحديث تحذيرات التكرار"); }
    catch(err){ setMsg(msg, err.message || String(err), false); }
  });

  async function approveReady(){
    if(!batchId) return;
    try{
      await postReadyLines(batchId);
      await refresh();
      setMsg(msg, "تم ترحيل البنود السليمة وربطها بالحزمة");
    }catch(err){ setMsg(msg, err.message || String(err), false); }
  }

  $("btnApproveReady").addEventListener("click", approveReady);
  $("btnApproveFinal").addEventListener("click", approveReady);

  $("btnDeleteBatch").addEventListener("click", async () => {
    if(!batchId) return;
    const ok = confirm("تحذير نهائي: سيتم حذف الحزمة نهائيًا وكل الحركات الناتجة عنها. لا يمكن التراجع. هل تريد الاستمرار؟");
    if(!ok) return;
    try{
      await deleteBatch(batchId);
      batchId = null;
      state.batch = null;
      state.lines = [];
      render();
      setMsg(msg, "تم حذف الحزمة نهائيًا");
    }catch(err){ setMsg(msg, err.message || String(err), false); }
  });

  items = await loadActiveItems();
  if(batchId) await refresh();
}
