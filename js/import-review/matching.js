import { cleanText, normalizeArabicDigits, normalizeMatchToken } from "../shared.js";
import { MATCH_CONFIG, MATCH_STATUS } from "./constants.js";
import { normalizeText } from "./normalize.js";

function trigrams(str){
  const s = `  ${str} `;
  const out = new Set();
  for(let i=0;i<s.length-2;i++) out.add(s.slice(i, i+3));
  return out;
}

function similarity(a, b){
  if(!a || !b) return 0;
  if(a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let hit = 0;
  for(const t of ta){ if(tb.has(t)) hit += 1; }
  return hit / Math.max(ta.size, tb.size, 1);
}

export function buildItemIndex(items){
  const list = (items || []).map(item => ({
    item,
    itemNameKey: normalizeMatchToken(item.item_name || ""),
    colorCodeKey: normalizeMatchToken(item.color_code || ""),
    itemText: normalizeText(cleanText(item.item_name || "")),
    colorCode: normalizeText(normalizeArabicDigits(cleanText(item.color_code || ""))),
    colorName: normalizeText(item.color_name || ""),
  }));

  const exactKeyToItem = new Map();
  for(const idx of list){
    exactKeyToItem.set(`${idx.itemNameKey}||${idx.colorCodeKey}`, idx.item);
  }

  return { list, exactKeyToItem };
}

export function smartMatchLine(rawLine, itemIndex, config = MATCH_CONFIG){
  const line = {
    itemNameKey: normalizeMatchToken(rawLine.raw_item_name),
    colorCodeKey: normalizeMatchToken(rawLine.raw_color_code),
    itemName: normalizeText(cleanText(rawLine.raw_item_name || "")),
    colorCode: normalizeText(normalizeArabicDigits(cleanText(rawLine.raw_color_code || ""))),
    colorName: normalizeText(rawLine.raw_color_name),
  };

  if(!line.itemNameKey || !line.colorCodeKey){
    return {
      match_status: MATCH_STATUS.UNKNOWN,
      matched_item_id: null,
      suggested_item_id: null,
      match_score: null,
      suggested_approved: false,
    };
  }

  const exact = itemIndex.exactKeyToItem.get(`${line.itemNameKey}||${line.colorCodeKey}`);
  if(exact){
    return { match_status: MATCH_STATUS.EXACT, matched_item_id: exact.id, suggested_item_id: null, match_score: 1, suggested_approved: false };
  }

  let best = null;
  for(const idx of itemIndex.list){
    if(!idx.itemNameKey || !idx.colorCodeKey) continue;
    const score =
      similarity(line.itemName, idx.itemText) * config.itemNameWeight +
      similarity(line.colorCode, idx.colorCode) * config.colorCodeWeight +
      similarity(line.colorName, idx.colorName) * config.colorNameWeight;

    if(similarity(line.colorCode, idx.colorCode) < 0.5) continue;

    if(!best || score > best.score){
      best = { id: idx.item.id, score };
    }
  }

  if(best && best.score >= config.suggestionThreshold){
    return {
      match_status: MATCH_STATUS.SUGGESTED,
      matched_item_id: null,
      suggested_item_id: best.id,
      match_score: Number(best.score.toFixed(4)),
      suggested_approved: false,
    };
  }

  return {
    match_status: MATCH_STATUS.UNKNOWN,
    matched_item_id: null,
    suggested_item_id: null,
    match_score: best ? Number(best.score.toFixed(4)) : null,
    suggested_approved: false,
  };
}
