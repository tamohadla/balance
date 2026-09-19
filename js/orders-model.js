export const STATUS = Object.freeze({draft:'مسودة', confirmed:'مؤكد', executed:'تم التنفيذ'});
export const SALES_PREFILL_KEY = 'sales_prefill_from_order';
export function statusOf(order){ return order.status || 'draft'; }
export function normalizeSearch(value){
  return String(value ?? '').toLowerCase().normalize('NFKC')
    .replace(/[٠-٩]/g, c=>String(c.charCodeAt(0)-1632))
    .replace(/[۰-۹]/g, c=>String(c.charCodeAt(0)-1776))
    .replace(/[\u064B-\u065F\u0640]/g,'').replace(/[أإآ]/g,'ا').trim();
}
export function totalRolls(lines=[]){ return lines.reduce((sum,line)=>sum+(Number(line.qty_rolls)||0),0); }
export function filterOrders(orders,{search='',status='all',period='all',sort='newest'}={},now=new Date()){
  const term=normalizeSearch(search);
  const start=new Date(now); start.setHours(0,0,0,0);
  if(period!=='today' && period!=='all') start.setDate(start.getDate()-Math.max(0,Number(period)-1));
  return orders.filter(order=>{
    if(status!=='all' && statusOf(order)!==status) return false;
    const date=new Date(order.created_at);
    if(period!=='all' && (!Number.isFinite(+date) || date<start || date>now)) return false;
    const compactTerm=term.replace(/[\s()+-]/g,'');
    const text=normalizeSearch([order.id,order.customer_name,order.customer_phone,order.note].join(' '));
    return !term || text.includes(term) || (compactTerm && normalizeSearch(order.customer_phone).replace(/[\s()+-]/g,'').includes(compactTerm));
  }).sort((a,b)=>{
    if(sort==='name') return String(a.customer_name||'').localeCompare(String(b.customer_name||''),'ar') || String(a.id).localeCompare(String(b.id));
    if(sort==='rolls') return totalRolls(b.customer_order_lines)-totalRolls(a.customer_order_lines) || String(b.created_at).localeCompare(String(a.created_at));
    const cmp=String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id));
    return sort==='oldest'?-cmp:cmp;
  });
}
export function salesPayload(order,lines){
  const usable=lines.filter(l=>Number(l.qty_rolls)>0);
  if(!usable.length) throw new Error('لا يحتوي الطلب على أثواب مطلوبة.');
  return {source:'customer_order',order_id:order.id,customer_name:order.customer_name,customer_phone:order.customer_phone,created_at:order.created_at,lines:usable.map(l=>({item_id:l.item_id,requested_rolls:Number(l.qty_rolls)}))};
}
// Prepare recoverable handoff before changing status; a storage failure must never execute an order.
export async function transferOrder({order,lines,storage,updateStatus,navigate}){
  const state=statusOf(order);
  if(!['draft','confirmed'].includes(state)) throw new Error('هذا الطلب منفذ بالفعل. حدّث القائمة لمراجعة حالته.');
  const payload=JSON.stringify(salesPayload(order,lines));
  const previous=storage.getItem(SALES_PREFILL_KEY);
  if(previous){
    let existing; try{existing=JSON.parse(previous);}catch{}
    if(existing?.order_id && existing.order_id!==order.id) throw new Error('يوجد طلب آخر بانتظار إدخال المبيعات. افتح صفحة المبيعات وأكمله أولًا.');
  }
  storage.setItem(SALES_PREFILL_KEY,payload);
  try{ await updateStatus(); }
  catch(error){
    // Keep this payload on an ambiguous network failure: the server may have committed.
    // It can be recovered from Sales; never silently lose an executed order's materials.
    throw error;
  }
  navigate('./sales.html?prefill=order');
}
