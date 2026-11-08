import { supabase } from '../supabaseClient.js';
import { createBatchService } from './batchServiceCore.js';

export const {
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
} = createBatchService(supabase);
