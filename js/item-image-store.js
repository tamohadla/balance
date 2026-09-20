import {recordImageReplacement, refreshSiteImages} from "./image-cache.js?v=200-1";
import {resizeImageBlob, thumbnailPath} from './image-variants.js?v=200-1';

export async function removeImagePair(client, path) {
  if (!path) return;
  const {error} = await client.storage.from('item-images').remove([path, thumbnailPath(path)]);
  if (error) throw error;
}

// Publish the pointer only after BOTH immutable files exist. A failed upload
// never overwrites the working pair. Compare-and-set also protects concurrent edits.
export async function saveImagePair(client, itemId, previousPath, file) {
  const full = await resizeImageBlob(file, 800);
  const small = await resizeImageBlob(full, 200);
  const path = `items/${itemId}_${crypto.randomUUID()}.jpg`;
  const storage = client.storage.from('item-images');
  let pointerAttempted = false;
  try {
    for (const [name, blob] of [[path, full], [thumbnailPath(path), small]]) {
      const {error} = await storage.upload(name, blob, {upsert:false, contentType:'image/jpeg', cacheControl:'3600'});
      if (error) throw error;
    }
    let update = client.from('items').update({image_path:path}).eq('id', itemId);
    update = previousPath == null ? update.is('image_path', null) : update.eq('image_path', previousPath);
    pointerAttempted = true;
    const {data, error} = await update.select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('تغيرت صورة المادة في جلسة أخرى. حدّث الصفحة وأعد المحاولة.');
  } catch (error) {
    // A lost HTTP response may hide a committed update. Verify before cleanup.
    if (pointerAttempted) {
      let current;
      try { current = await client.from('items').select('image_path').eq('id', itemId).single(); }
      catch { throw error; }
      if (current.error) throw error; // retain files when commit status is unknown
      if (current.data?.image_path !== path) {
        await removeImagePair(client, path).catch(() => {});
        throw error;
      }
    } else {
      await removeImagePair(client, path).catch(() => {});
      throw error;
    }
  }
  recordImageReplacement(previousPath, path);
  try { refreshSiteImages(); } catch { /* new paths also bypass old CDN caches */ }
  // An old pair may remain if storage cleanup is unavailable; surface that fact.
  let cleanupError = null;
  try { await removeImagePair(client, previousPath); } catch (error) { cleanupError = error; }
  return {path, cleanupError};
}
