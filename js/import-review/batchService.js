import { supabase } from "../supabaseClient.js";
import { BATCH_STATUS, MATCH_STATUS } from "./constants.js";
import { smartMatchLine, buildItemIndex } from "./matching.js";
import { toISODate, toInt, toNumber } from "./normalize.js";

async function nextBatchNo(batchType){
  const prefix = batchType === "purchase" ? "PUR-IMP" : "SAL-IMP";
  const stamp = new Date().toISOString().slice(0,10).replaceAll("-", "");
  const { count } = await supabase.from("import_batches").select("id", { count: "exact", head: true }).eq("batch_type", batchType);
  return `${prefix}-${stamp}-${String((count || 0) + 1).padStart(4, "0")}`;
}

export async function loadActiveItems(){
  const { data, error } = await supabase
    .from("items")
    .select("id, main_category, sub_category, item_name, color_code, color_name, unit_type, image_path")
    .eq("is_active", true)
    .order("main_category", { ascending: true })
    .order("sub_category", { ascending: true })
    .order("item_name", { ascending: true })
    .order("color_code", { ascending: true });
  if(error) throw error;
  return data || [];
}

export async function createBatchWithLines({ batchType, fileName, lines, notes }){
  const batchNo = await nextBatchNo(batchType);
  const { data: batch, error: bErr } = await supabase.from("import_batches").insert({
    batch_no: batchNo,
    batch_type: batchType,
    source_file_name: fileName || "uploaded-file",
    notes: notes || null,
    status: BATCH_STATUS.DRAFT,
  }).select("*").single();
  if(bErr) throw bErr;

  const payload = (lines || []).map((r, idx) => ({
    batch_id: batch.id,
    row_index: idx + 1,
    raw_item_name: r.raw_item_name || null,
    raw_color_code: r.raw_color_code || null,
    raw_color_name: r.raw_color_name || null,
    raw_qty_primary: toNumber(r.raw_qty_primary),
    raw_rolls: toInt(r.raw_rolls),
    raw_date: toISODate(r.raw_date),
    raw_notes: r.raw_notes || null,
  }));

  const { data: insertedLines, error: lErr } = await supabase.from("import_batch_lines").insert(payload).select("*");
  if(lErr) throw lErr;

  return { batch, lines: insertedLines || [] };
}

export async function runSmartValidation(batchId, items){
  const { data: lines, error } = await supabase.from("import_batch_lines").select("*").eq("batch_id", batchId).order("row_index", { ascending: true });
  if(error) throw error;
  const idx = buildItemIndex(items);

  for(const line of (lines || [])){
    const match = smartMatchLine(line, idx);
    const { error: uErr } = await supabase.from("import_batch_lines").update(match).eq("id", line.id);
    if(uErr) throw uErr;
  }

  return recomputeBatchStats(batchId);
}

export async function recomputeBatchStats(batchId){
  const { data: lines, error } = await supabase.from("import_batch_lines").select("id, match_status, is_included, is_posted").eq("batch_id", batchId);
  if(error) throw error;

  const stats = {
    total_lines: lines.length,
    exact_matched_lines: lines.filter(x => x.match_status === MATCH_STATUS.EXACT).length,
    suggested_lines: lines.filter(x => x.match_status === MATCH_STATUS.SUGGESTED).length,
    manual_matched_lines: lines.filter(x => x.match_status === MATCH_STATUS.MANUAL).length,
    unknown_lines: lines.filter(x => x.match_status === MATCH_STATUS.UNKNOWN).length,
    duplicate_warning_lines: lines.filter(x => x.match_status === MATCH_STATUS.DUPLICATE).length,
    excluded_lines: lines.filter(x => !x.is_included).length,
    approved_lines_count: lines.filter(x => x.is_posted).length,
    pending_lines_count: lines.filter(x => x.is_included && !x.is_posted).length,
  };

  let status = BATCH_STATUS.DRAFT;
  if(stats.approved_lines_count > 0 && stats.pending_lines_count > 0) status = BATCH_STATUS.PARTIAL;
  if(stats.approved_lines_count > 0 && stats.pending_lines_count === 0) status = BATCH_STATUS.APPROVED;

  const patch = { ...stats, status };
  if(status === BATCH_STATUS.APPROVED) patch.approved_at = new Date().toISOString();

  const { data: batch, error: uErr } = await supabase.from("import_batches").update(patch).eq("id", batchId).select("*").single();
  if(uErr) throw uErr;
  return { batch, stats };
}

export async function loadBatch(batchId){
  const { data: batch, error: bErr } = await supabase.from("import_batches").select("*").eq("id", batchId).single();
  if(bErr) throw bErr;
  const { data: lines, error: lErr } = await supabase
    .from("import_batch_lines")
    .select("*, matched_item:items!import_batch_lines_matched_item_id_fkey(id, main_category, sub_category, item_name, color_code, color_name), suggested_item:items!import_batch_lines_suggested_item_id_fkey(id, main_category, sub_category, item_name, color_code, color_name)")
    .eq("batch_id", batchId)
    .order("row_index", { ascending: true });
  if(lErr) throw lErr;
  return { batch, lines: lines || [] };
}

export async function updateLine(lineId, patch){
  const { data, error } = await supabase.from("import_batch_lines").update(patch).eq("id", lineId).select("*").single();
  if(error) throw error;
  return data;
}

export async function detectDuplicates(batch){
  const { data: lines, error } = await supabase.from("import_batch_lines").select("*")
    .eq("batch_id", batch.id)
    .eq("is_included", true)
    .eq("is_posted", false);
  if(error) throw error;

  for(const line of (lines || [])){
    const itemId = line.matched_item_id || (line.suggested_approved ? line.suggested_item_id : null);
    if(!itemId || !line.raw_date || !line.raw_qty_primary) continue;

    let q = supabase.from("stock_moves").select("id, move_date, qty_main_in, qty_main_out, qty_rolls_in, qty_rolls_out, note")
      .eq("type", batch.batch_type)
      .eq("item_id", itemId)
      .eq("move_date", line.raw_date);

    if(batch.batch_type === "purchase") q = q.eq("qty_main_in", line.raw_qty_primary);
    else q = q.eq("qty_main_out", line.raw_qty_primary);

    if(line.raw_rolls) {
      if(batch.batch_type === "purchase") q = q.eq("qty_rolls_in", line.raw_rolls);
      else q = q.eq("qty_rolls_out", line.raw_rolls);
    }

    const { data: dupRows, error: dErr } = await q.limit(8);
    if(dErr) throw dErr;

    if((dupRows || []).length){
      await updateLine(line.id, {
        match_status: MATCH_STATUS.DUPLICATE,
        duplicate_warning_payload: { existing_moves: dupRows },
        duplicate_approved: false,
      });
    }
  }
}

function lineToMove(batchType, line, itemId){
  const payload = {
    type: batchType,
    move_date: line.raw_date || new Date().toISOString().slice(0,10),
    item_id: itemId,
    qty_main_in: 0,
    qty_main_out: 0,
    qty_rolls_in: 0,
    qty_rolls_out: 0,
    note: line.raw_notes || `Imported by batch line ${line.row_index}`,
    import_batch_id: line.batch_id,
    import_batch_line_id: line.id,
  };
  if(batchType === "purchase"){
    payload.qty_main_in = Number(line.raw_qty_primary || 0);
    payload.qty_rolls_in = Number(line.raw_rolls || 0);
  }else{
    payload.qty_main_out = Number(line.raw_qty_primary || 0);
    payload.qty_rolls_out = Number(line.raw_rolls || 0);
  }
  return payload;
}

export async function postReadyLines(batchId){
  const { data: batch, error: bErr } = await supabase.from("import_batches").select("*").eq("id", batchId).single();
  if(bErr) throw bErr;

  const { data: lines, error: lErr } = await supabase.from("import_batch_lines").select("*").eq("batch_id", batchId);
  if(lErr) throw lErr;

  const ready = (lines || []).filter(line => {
    if(line.is_posted || !line.is_included) return false;
    const suggestedReady = line.match_status === MATCH_STATUS.SUGGESTED && line.suggested_approved && line.suggested_item_id;
    const directReady = (line.match_status === MATCH_STATUS.EXACT || line.match_status === MATCH_STATUS.MANUAL) && line.matched_item_id;
    const duplicateReady = line.match_status === MATCH_STATUS.DUPLICATE && line.duplicate_approved && (line.matched_item_id || line.suggested_item_id);
    return suggestedReady || directReady || duplicateReady;
  });

  for(const line of ready){
    const itemId = line.matched_item_id || line.suggested_item_id;
    const payload = lineToMove(batch.batch_type, line, itemId);
    const { error: mErr } = await supabase.from("stock_moves").insert(payload);
    if(mErr){
      if(String(mErr.code) === "23505") continue;
      throw mErr;
    }
    const { error: uErr } = await supabase.from("import_batch_lines").update({ is_posted: true, posted_at: new Date().toISOString() }).eq("id", line.id);
    if(uErr) throw uErr;
  }

  return recomputeBatchStats(batchId);
}

export async function listBatches(){
  const { data, error } = await supabase.from("import_batches").select("*").order("created_at", { ascending: false });
  if(error) throw error;
  return data || [];
}

export async function deleteBatch(batchId){
  const { error } = await supabase.from("import_batches").delete().eq("id", batchId);
  if(error) throw error;
}
