import {resizeImageBlob} from './image-variants.js?v=224-1';
import {supabase} from './supabaseClient.js';
import {requireAccess} from './auth-guard.js';
const suffix = '.thumb-224.jpg';
const marker = '/storage/v1/object/public/item-images/';
const pending = new Map();
const localUrls = new Map();
if (typeof document !== 'undefined') {
  new MutationObserver(() => {
    for (const [img, url] of localUrls) {
      if (!img.isConnected || img.src !== url) { URL.revokeObjectURL(url); localUrls.delete(img); }
    }
  }).observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:['src']});
}
let active = 0;
const waiting = [];
async function limited(work) {
  if (active >= 3) await new Promise(resolve => waiting.push(resolve));
  active++;
  try { return await work(); } finally { active--; waiting.shift()?.(); }
}
async function createLegacyThumbnail(url) {
  const original = new URL(url); original.pathname = original.pathname.slice(0, -suffix.length);
  const response = await fetch(original);
  if (!response.ok) throw new Error('Image unavailable');
  const blob = await resizeImageBlob(await response.blob(), 224, true);
  try {
  const access = await requireAccess();
  if (access.member?.role === 'admin') {
    // Add a missing derivative only. Never overwrite an existing thumbnail.
    const path = decodeURIComponent(new URL(url).pathname.split(marker)[1]);
    const originalPath = path.slice(0, -suffix.length);
    const {data, error} = await supabase.from('items').select('id').eq('image_path', originalPath).limit(1);
    if (!error && data?.length) {
      const uploaded = await supabase.storage.from('item-images').upload(path, blob, {upsert:false, contentType:'image/jpeg', cacheControl:'3600'});
      if (!uploaded.error) {
        // The item may have been replaced/deleted while the thumbnail was uploading.
        const check = await supabase.from('items').select('id').eq('image_path', originalPath).limit(1);
        if (!check.error && !check.data?.length) await supabase.storage.from('item-images').remove([path]);
      }
    }
  }
  } catch { /* A storage outage must not prevent the local thumbnail display. */ }
  return blob;
}
// Existing materials acquire a 224px square derivative on demand, without changing originals.
// Viewers can display a local derivative; only administrators can persist it (RLS).
if (typeof document !== 'undefined') document.addEventListener('error', async event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  const attempted = img.src;
  let url;
  try { url = new URL(attempted); } catch { return; }
  if (!url.pathname.includes(marker) || !url.pathname.endsWith(suffix)) return;
  img.dataset.thumbnailUrl = attempted;
  try {
    if (!pending.has(attempted)) pending.set(attempted, limited(() => createLegacyThumbnail(attempted)).finally(() => pending.delete(attempted)));
    const blob = await pending.get(attempted);
    if (!img.isConnected || img.src !== attempted) return;
    const local = URL.createObjectURL(blob);
    if(localUrls.has(img)) URL.revokeObjectURL(localUrls.get(img));
    localUrls.set(img, local);
    img.src = local;
  } catch {
    if (img.src !== attempted) return;
    url.pathname = url.pathname.slice(0, -suffix.length);
    img.src = url.href;
  }
}, true);
