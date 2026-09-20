import {comparePurchases} from "./purchase-sort.js";
import { normalizeSearch } from './orders-model.js';
export function quantity(value){
  const text=normalizeSearch(value);
  if(!/^\d+$/.test(text))return null;
  const n=Number(text);return Number.isSafeInteger(n)&&n>=0&&n<=100000?n:null;
}
export function cleanCart(cart){
  const result={};if(!cart||typeof cart!=='object'||Array.isArray(cart))return result;
  for(const [id,value] of Object.entries(cart)){const n=quantity(value);if(n>0&&/^[\da-f-]{36}$/i.test(id))result[id]=n;}
  return result;
}
export function cartTotals(cart){return {items:Object.keys(cart).length,rolls:Object.values(cart).reduce((sum,v)=>sum+v,0)};}
export function filterCatalog(rows,filters,cart){
  const words=normalizeSearch(filters.search).split(/\s+/).filter(Boolean);
  return rows.filter(r=>r.is_active&&(!filters.main||r.main_category===filters.main)&&(!filters.sub||r.sub_category===filters.sub)
    &&(!filters.available||r.balance_rolls>0)&&(!filters.selected||cart[r.id]>0)&&(!filters.pending||r.pending_rolls>0)
    &&words.every(word=>normalizeSearch([r.main_category,r.sub_category,r.item_name,r.color_code,r.color_name].join(' ')).includes(word)))
    .sort((a,b)=>{
      if(["purchase_newest","purchase_oldest"].includes(filters.sort))return comparePurchases(a,b,filters.sort);
      if(filters.sort==='stock')return b.balance_rolls-a.balance_rolls||String(a.id).localeCompare(String(b.id));
      const fields=filters.sort==='name'?['item_name','color_code','id']:['main_category','sub_category','item_name','color_code','id'];
      for(const key of fields){const c=String(a[key]||'').localeCompare(String(b[key]||''),'ar',{numeric:true});if(c)return c;}return 0;
    });
}
export function stockIssues(cart,items){
  return Object.entries(cart).map(([id,qty])=>({id,qty,item:items.get(id)})).filter(l=>!l.item?.is_active||l.qty>l.item.balance_rolls-l.item.pending_rolls);
}
