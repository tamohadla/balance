import {
  cleanText,
  normalizeArabicDigits,
  escapeHtml,
  materialLabel,
  normalizeMatchToken,
  formatItemFullLabel,
  groupLabel,
} from './core/text-utils.js';
export {
  cleanText,
  normalizeArabicDigits,
  escapeHtml,
  materialLabel,
  normalizeMatchToken,
  formatItemFullLabel,
  groupLabel,
};
import './image-thumbnails.js';
import { thumbnailPath } from './image-variants.js';
import { imageUrlWithRevision } from './image-cache.js';
import { supabase } from './supabaseClient.js';

export const APP_VERSION = 'v7';

export function $(id) {
  return document.getElementById(id);
}

export function setMsg(el, text, ok = true) {
  if (!el) return;
  el.textContent = text || '';
  el.className = 'msg ' + (ok ? 'ok' : 'err');
}

export function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function unitLabel(unit_type) {
  return unit_type === 'kg' ? 'كغ' : unit_type === 'm' ? 'متر' : '';
}

export function appendCacheBuster(url, bustValue) {
  if (!url || !bustValue) return url || '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(String(bustValue))}`;
}

export function getPublicImageUrl(image_path, bustValue) {
  if (!image_path) return '';
  const { data } = supabase.storage.from('item-images').getPublicUrl(image_path);
  return imageUrlWithRevision(appendCacheBuster(data?.publicUrl || '', bustValue));
}

export function getThumbnailImageUrl(path, bustValue) {
  return getPublicImageUrl(thumbnailPath(path), bustValue);
}

export function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

export function keysLookUnchanged(url, key) {
  return !url || !key || url.includes('PUT_YOUR_') || key.includes('PUT_YOUR_');
}

export function explainSupabaseError(error) {
  if (!error) return 'خطأ غير معروف';
  const parts = [];
  if (error.message) parts.push(error.message);
  if (error.details) parts.push(error.details);
  if (error.hint) parts.push(error.hint);
  if (error.code) parts.push(`code: ${error.code}`);
  return parts.join(' | ');
}

// اتصال سريع + تشخيص صلاحيات anon
export async function testSupabaseConnection(msgEl) {
  try {
    const { error } = await supabase
      .from('items')
      .select('id', { head: true, count: 'exact' })
      .limit(1);
    if (error) {
      const e = explainSupabaseError(error);
      setMsg(
        msgEl,
        `فشل الاتصال/الصلاحيات مع Supabase: ${e} — تحقق من صلاحية حسابك أو تواصل مع المسؤول.`,
        false,
      );
      return false;
    }
    return true;
  } catch (ex) {
    setMsg(msgEl, `تعذر الاتصال بـ Supabase: ${ex?.message || String(ex)}`, false);
    return false;
  }
}
