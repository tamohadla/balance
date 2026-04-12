import { materialLabel } from "../shared.js";
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
  return (items || []).map(item => {
    const itemText = normalizeText(materialLabel(item));
    const colorCode = normalizeText(item.color_code || "");
    const colorName = normalizeText(item.color_name || "");
    return { item, itemText, colorCode, colorName };
  });
}

export function smartMatchLine(rawLine, itemIndex, config = MATCH_CONFIG){
  const line = {
    itemName: normalizeText(rawLine.raw_item_name),
    colorCode: normalizeText(rawLine.raw_color_code),
    colorName: normalizeText(rawLine.raw_color_name),
  };

  const exact = itemIndex.find(x => x.itemText === line.itemName && (!line.colorCode || x.colorCode === line.colorCode));
  if(exact){
    return { match_status: MATCH_STATUS.EXACT, matched_item_id: exact.item.id, suggested_item_id: null, match_score: 1, suggested_approved: false };
  }

  let best = null;
  for(const idx of itemIndex){
    const score =
      similarity(line.itemName, idx.itemText) * config.itemNameWeight +
      similarity(line.colorCode, idx.colorCode) * config.colorCodeWeight +
      similarity(line.colorName, idx.colorName) * config.colorNameWeight;

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
