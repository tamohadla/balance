import { readAllRows } from '../core/pagination.js';
import { BATCH_STATUS, MATCH_STATUS } from './constants.js';
import { smartMatchLine, buildItemIndex } from './matching.js';
import { toISODate, toInt, toNumber } from './normalize.js';
import { MAX_IMPORT_ROWS } from './bulkItems.js';

const ITEM_FIELDS =
  'id,main_category,sub_category,item_name,color_code,color_name,unit_type,image_path';
const MOVE_FIELDS = 'id,item_id,move_date,qty_main_in,qty_main_out,qty_rolls_in,qty_rolls_out,note';

async function runLimited(tasks, concurrency = 4) {
  let next = 0;
  // Wait for all in-flight work before surfacing an error so the UI cannot start
  // another operation while requests from the previous operation are still running.
  const errors = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (next < tasks.length && !errors.length) {
        const task = tasks[next++];
        try {
          await task();
        } catch (error) {
          errors.push(error);
        }
      }
    }),
  );
  if (errors.length) throw errors[0];
}

function recoverableError(error, batchId) {
  const result = new Error(
    error?.message || 'تعذر إكمال حفظ الحزمة. راجع الحزمة قبل رفع الملف مجددًا.',
    { cause: error },
  );
  result.batchId = batchId;
  result.code = error?.code;
  return result;
}

function prepareLines(lines, batchId) {
  if (!Array.isArray(lines) || !lines.length || lines.length > MAX_IMPORT_ROWS)
    throw new Error(`يجب أن يحتوي الملف على 1 إلى ${MAX_IMPORT_ROWS} سطر.`);
  return lines.map((row, index) => {
    const quantity = toNumber(row.raw_qty_primary);
    const rolls = toInt(row.raw_rolls);
    const date = toISODate(row.raw_date);
    if (
      (String(row.raw_rolls ?? '').trim() && rolls === null) ||
      (String(row.raw_qty_primary ?? '').trim() && quantity === null) ||
      (String(row.raw_date ?? '').trim() && date === null)
    ) {
      throw new Error(`السطر ${index + 1}: تحقق من التاريخ والكمية وعدد الأثواب الصحيح.`);
    }
    return {
      batch_id: batchId,
      row_index: index + 1,
      raw_item_name: row.raw_item_name || null,
      raw_color_code: row.raw_color_code || null,
      raw_color_name: row.raw_color_name || null,
      raw_qty_primary: quantity,
      raw_rolls: rolls,
      raw_date: date,
      raw_notes: row.raw_notes || null,
    };
  });
}

function samePayload(actual, expected) {
  if (actual.length !== expected.length) return false;
  const byRow = new Map(actual.map((row) => [row.row_index, row]));
  return expected.every((row) => {
    const found = byRow.get(row.row_index);
    return found && Object.entries(row).every(([key, value]) => found[key] === value);
  });
}

/** Injecting the client keeps auth/DOM initialization out of service tests. */
export function createBatchService(
  client,
  { readRows = readAllRows, uuid = () => crypto.randomUUID(), now = () => new Date() } = {},
) {
  async function loadActiveItems() {
    return readRows(() =>
      client
        .from('items')
        .select(ITEM_FIELDS)
        .eq('is_active', true)
        .order('main_category')
        .order('sub_category')
        .order('item_name')
        .order('color_code')
        .order('id'),
    );
  }

  async function createBatchWithLines({ batchType, fileName, lines, notes }) {
    if (!['purchase', 'sale'].includes(batchType)) throw new Error('نوع الحزمة غير صالح.');
    const batchId = uuid();
    const payload = prepareLines(lines, batchId);
    const stamp = now().toISOString().slice(0, 10).replaceAll('-', '');
    const batchNo = `${batchType === 'purchase' ? 'PUR-IMP' : 'SAL-IMP'}-${stamp}-${batchId}`;
    const header = {
      id: batchId,
      batch_no: batchNo,
      batch_type: batchType,
      source_file_name: fileName || 'uploaded-file',
      notes: notes || null,
      status: BATCH_STATUS.DRAFT,
    };
    try {
      const created = await client.from('import_batches').insert(header).select('*').single();
      let batch = created.data;
      if (created.error) {
        // An HTTP failure can hide a committed insert. Read the known id; never
        // create another header or delete a potentially committed import blindly.
        const recovered = await client
          .from('import_batches')
          .select('*')
          .eq('id', batchId)
          .maybeSingle();
        if (recovered.error || recovered.data?.batch_no !== batchNo)
          throw recoverableError(created.error, batchId);
        batch = recovered.data;
      }
      const inserted = await client.from('import_batch_lines').insert(payload);
      if (inserted.error) {
        try {
          const saved = await readRows(() =>
            client
              .from('import_batch_lines')
              .select('*')
              .eq('batch_id', batchId)
              .order('row_index')
              .order('id'),
          );
          if (samePayload(saved, payload)) return { batch, lines: saved };
        } catch {
          /* Retain the known id when the commit cannot be established. */
        }
        throw recoverableError(inserted.error, batchId);
      }
      // Do not depend on an insert representation capped by the REST row limit.
      const saved = await readRows(() =>
        client
          .from('import_batch_lines')
          .select('*')
          .eq('batch_id', batchId)
          .order('row_index')
          .order('id'),
      );
      return { batch, lines: saved };
    } catch (error) {
      throw recoverableError(error, batchId);
    }
  }

  async function applyPatches(patches) {
    const groups = new Map();
    for (const { id, patch } of patches) {
      const key = JSON.stringify(patch);
      if (!groups.has(key)) groups.set(key, { patch, ids: [] });
      groups.get(key).ids.push(id);
    }
    const tasks = [];
    for (const { patch, ids } of groups.values()) {
      for (let offset = 0; offset < ids.length; offset += 100) {
        const chunk = ids.slice(offset, offset + 100);
        tasks.push(async () => {
          const { error } = await client
            .from('import_batch_lines')
            .update(patch)
            .in('id', chunk)
            .eq('is_posted', false);
          if (error) throw error;
        });
      }
    }
    await runLimited(tasks);
  }

  async function runSmartValidation(batchId, items) {
    const lines = await readRows(() =>
      client
        .from('import_batch_lines')
        .select('*')
        .eq('batch_id', batchId)
        .eq('is_posted', false)
        .order('row_index')
        .order('id'),
    );
    const index = buildItemIndex(items);
    await applyPatches(lines.map((line) => ({ id: line.id, patch: smartMatchLine(line, index) })));
    return recomputeBatchStats(batchId);
  }

  async function recomputeBatchStats(batchId) {
    const lines = await readRows(() =>
      client
        .from('import_batch_lines')
        .select('id,match_status,is_included,is_posted')
        .eq('batch_id', batchId)
        .order('id'),
    );
    const stats = {
      total_lines: lines.length,
      exact_matched_lines: 0,
      suggested_lines: 0,
      manual_matched_lines: 0,
      unknown_lines: 0,
      duplicate_warning_lines: 0,
      excluded_lines: 0,
      approved_lines_count: 0,
      pending_lines_count: 0,
    };
    const counters = {
      [MATCH_STATUS.EXACT]: 'exact_matched_lines',
      [MATCH_STATUS.SUGGESTED]: 'suggested_lines',
      [MATCH_STATUS.MANUAL]: 'manual_matched_lines',
      [MATCH_STATUS.UNKNOWN]: 'unknown_lines',
      [MATCH_STATUS.DUPLICATE]: 'duplicate_warning_lines',
    };
    for (const line of lines) {
      if (counters[line.match_status]) stats[counters[line.match_status]]++;
      if (!line.is_included) stats.excluded_lines++;
      if (line.is_posted) stats.approved_lines_count++;
      if (line.is_included && !line.is_posted) stats.pending_lines_count++;
    }
    let status = BATCH_STATUS.DRAFT;
    if (stats.approved_lines_count > 0)
      status = stats.pending_lines_count > 0 ? BATCH_STATUS.PARTIAL : BATCH_STATUS.APPROVED;
    const { data, error } = await client
      .from('import_batches')
      .update({
        ...stats,
        status,
        approved_at: status === BATCH_STATUS.APPROVED ? now().toISOString() : null,
      })
      .eq('id', batchId)
      .neq('status', BATCH_STATUS.CANCELLED)
      .select('*')
      .single();
    if (error) throw error;
    return { batch: data, stats };
  }

  async function loadBatch(batchId) {
    const { data: batch, error } = await client
      .from('import_batches')
      .select('*')
      .eq('id', batchId)
      .single();
    if (error) throw error;
    const lines = await readRows(() =>
      client
        .from('import_batch_lines')
        .select(
          '*,matched_item:items!import_batch_lines_matched_item_id_fkey(id,main_category,sub_category,item_name,color_code,color_name),suggested_item:items!import_batch_lines_suggested_item_id_fkey(id,main_category,sub_category,item_name,color_code,color_name)',
        )
        .eq('batch_id', batchId)
        .order('row_index')
        .order('id'),
    );
    return { batch, lines };
  }

  async function updateLine(lineId, patch) {
    const { data, error } = await client
      .from('import_batch_lines')
      .update(patch)
      .eq('id', lineId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async function detectDuplicates(batch) {
    const lines = await readRows(() =>
      client
        .from('import_batch_lines')
        .select('*')
        .eq('batch_id', batch.id)
        .eq('is_included', true)
        .eq('is_posted', false)
        .order('id'),
    );
    const candidates = lines
      .map((line) => ({
        line,
        itemId: line.matched_item_id || (line.suggested_approved ? line.suggested_item_id : null),
      }))
      .filter(({ line, itemId }) => itemId && line.raw_date && line.raw_qty_primary);
    if (!candidates.length) return;
    const ids = [...new Set(candidates.map((candidate) => candidate.itemId))];
    const dates = candidates.map((candidate) => candidate.line.raw_date).sort();
    const moveIndex = new Map();
    const quantityField = batch.batch_type === 'purchase' ? 'qty_main_in' : 'qty_main_out';
    const rollsField = batch.batch_type === 'purchase' ? 'qty_rolls_in' : 'qty_rolls_out';
    for (let offset = 0; offset < ids.length; offset += 100) {
      const chunk = ids.slice(offset, offset + 100);
      const moves = await readRows(() =>
        client
          .from('stock_moves')
          .select(MOVE_FIELDS)
          .eq('type', batch.batch_type)
          .in('item_id', chunk)
          .gte('move_date', dates[0])
          .lte('move_date', dates.at(-1))
          .order('id'),
      );
      for (const move of moves) {
        const key = `${move.item_id}|${move.move_date}|${Number(move[quantityField])}`;
        if (!moveIndex.has(key)) moveIndex.set(key, []);
        moveIndex.get(key).push(move);
      }
    }
    const patches = [];
    for (const { line, itemId } of candidates) {
      const key = `${itemId}|${line.raw_date}|${Number(line.raw_qty_primary)}`;
      const matches = (moveIndex.get(key) || [])
        .filter(
          (move) => line.raw_rolls == null || Number(move[rollsField]) === Number(line.raw_rolls),
        )
        .slice(0, 8);
      if (matches.length)
        patches.push({
          id: line.id,
          patch: {
            match_status: MATCH_STATUS.DUPLICATE,
            duplicate_warning_payload: { existing_moves: matches },
            duplicate_approved: false,
          },
        });
    }
    await applyPatches(patches);
  }

  async function postReadyLines(batchId) {
    const { error } = await client.rpc('post_stock_import', { p_batch: batchId });
    if (error) throw error;
    return loadBatch(batchId);
  }

  function listBatches() {
    return readRows(() =>
      client
        .from('import_batches')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id'),
    );
  }

  async function deleteBatch(batchId) {
    const { error } = await client.from('import_batches').delete().eq('id', batchId);
    if (error) throw error;
  }

  return {
    loadActiveItems,
    createBatchWithLines,
    runSmartValidation,
    recomputeBatchStats,
    loadBatch,
    updateLine,
    detectDuplicates,
    postReadyLines,
    listBatches,
    deleteBatch,
  };
}
