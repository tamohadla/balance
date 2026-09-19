import { supabase } from './supabaseClient.js';
import { requireAccess } from './auth-guard.js';
import { $, escapeHtml as esc, materialLabel, explainSupabaseError, getPublicImageUrl } from './shared.js';
import { STATUS, statusOf, totalRolls, filterOrders, transferOrder, SALES_PREFILL_KEY } from './orders-model.js';

const access=await requireAccess();
const canWrite=access.member.role==='admin';
const PAGE_SIZE=12;
const ORDER_FIELDS='id, created_at, customer_name, customer_phone, status, note';
const ITEM_FIELDS='id, main_category, sub_category, item_name, color_code, color_name, image_path, is_active';
const dialog=$('orderDialog');
let orders=[],page=1,activeStatus='all',loadVersion=0,detailVersion=0,renderVersion=0;
let current=null,currentLines=[],currentItems=new Map(),action=null,busy=false,loaded=false;
let itemCache=new Map(),imageLibraryPromise;
const dateFormat=new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'short',year:'numeric'});
const number=new Intl.NumberFormat('en-US');
function date(ts){const value=new Date(ts);return Number.isFinite(+value)?dateFormat.format(value):'تاريخ غير متاح';}
function message(text='',error=false,target='msg'){
  const el=$(target);el.textContent=text;el.hidden=!text;el.dataset.error=String(error);
}
function friendly(error){ return error?.message && !error.code ? error.message : explainSupabaseError(error); }
function reference(id){return String(id).slice(0,8).toUpperCase();}
function badge(order){const state=statusOf(order);return `<span class="order-status ${STATUS[state]?state:'unknown'}">${esc(STATUS[state]||'حالة أخرى')}</span>`;}
function phoneLink(value){const phone=String(value||'').replace(/[^+\d]/g,'');return phone?`<a href="tel:${esc(phone)}" dir="ltr">${esc(value)}</a>`:'<span class="subtle">لا يوجد رقم هاتف</span>';}
function params(){return {search:$('search').value,status:activeStatus,period:$('period').value,sort:$('sort').value};}
function filtered(){return filterOrders(orders,params());}
function updateStats(){
  const counts={all:orders.length,draft:0,confirmed:0,executed:0};
  for(const o of orders)if(statusOf(o) in counts) counts[statusOf(o)]++;
  for(const [state,key] of [['all','All'],['draft','Draft'],['confirmed','Confirmed'],['executed','Executed']]){
    $('stat'+key).textContent=number.format(counts[state]);$('count'+key).textContent=number.format(counts[state]);
  }
}
function render(){
  const version=++renderVersion;
  const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));page=Math.min(page,pages);
  const visible=rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  $('resultCount').textContent=rows.length?`عرض ${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,rows.length)} من ${number.format(rows.length)} طلب`:'لا توجد طلبات للعرض';
  $('pageInfo').textContent=`${page} / ${pages}`;$('prevPage').disabled=page<=1;$('nextPage').disabled=page>=pages;
  const hasFilter=$('search').value.trim()||activeStatus!=='all'||$('period').value!=='all';
  $('resetFilters').hidden=!hasFilter;
  $('ordersGrid').innerHTML=visible.map(o=>{
    const lines=o.customer_order_lines||[];
    return `<article class="order-card"><div class="order-card-top"><span class="order-reference">#${esc(reference(o.id))}</span>${badge(o)}</div><div class="order-card-body"><div class="customer-row"><span class="customer-avatar" aria-hidden="true">${esc((o.customer_name||'ع').trim().slice(0,1))}</span><div><h2>${esc(o.customer_name||'عميل بدون اسم')}</h2><p><bdi>${esc(o.customer_phone||'لا يوجد رقم هاتف')}</bdi></p></div></div><p class="order-card-date">${esc(date(o.created_at))}</p><div class="order-preview" data-preview="${esc(o.id)}" aria-label="صور خامات الطلب">${preview(lines)}</div><div class="order-totals"><span><strong>${number.format(lines.length)}</strong> صنف</span><span><strong>${number.format(totalRolls(lines))}</strong> ثوب</span></div>${o.note?`<p class="order-note" title="${esc(o.note)}">${esc(o.note)}</p>`:''}</div><footer class="order-card-footer"><button class="o-button" data-open="${esc(o.id)}" aria-label="عرض طلب ${esc(o.customer_name||'العميل')}">عرض الطلب <span aria-hidden="true">←</span></button></footer></article>`;
  }).join('');
  $('ordersGrid').setAttribute('aria-busy','false');
  $('emptyState').hidden=!!rows.length;
  $('emptyTitle').textContent=hasFilter?'لا توجد نتائج مطابقة':'لا توجد طلبات بعد';
  $('emptyText').textContent=hasFilter?'جرّب اسمًا آخر أو امسح الفلاتر لعرض كل الطلبات.':'ستظهر هنا الطلبات التي تحفظها من صفحة إنشاء الطلب.';
  $('emptyAction').textContent=hasFilter?'مسح الفلاتر':'طلب جديد';
  $('emptyAction').dataset.mode=hasFilter?'reset':'new';$('emptyAction').hidden=false;
  hydratePreviews(visible,version);
}
function preview(lines){
  const unique=[...new Set(lines.map(l=>String(l.item_id)))];
  const thumbs=unique.slice(0,3).map(id=>{const it=itemCache.get(id);const url=it?.image_path?getPublicImageUrl(it.image_path):null;return url?`<img src="${esc(url)}" alt="${esc(it.item_name||'خامة')}" width="64" height="64" loading="lazy" decoding="async">`:'<span class="preview-placeholder" aria-label="صورة غير متاحة">▧</span>';}).join('');
  return thumbs+(unique.length>3?`<span class="preview-more">+${unique.length-3}</span>`:'')||'<span class="subtle">الطلب لا يحتوي على أصناف</span>';
}
async function itemsByIds(ids){
  const missing=[...new Set(ids.map(String))].filter(id=>!itemCache.has(id));
  for(let i=0;i<missing.length;i+=150){
    const chunk=missing.slice(i,i+150);
    const {data,error}=await supabase.from('items').select(ITEM_FIELDS).in('id',chunk);
    if(error) throw error;
    for(const id of chunk)itemCache.set(id,null);
    for(const it of data||[])itemCache.set(String(it.id),it);
  }
  return new Map(ids.map(id=>[String(id),itemCache.get(String(id))]));
}
async function hydratePreviews(visible,version){
  try{
    await itemsByIds(visible.flatMap(o=>(o.customer_order_lines||[]).slice(0,3).map(l=>l.item_id)));
    if(version!==renderVersion)return;
    for(const el of $('ordersGrid').querySelectorAll('[data-preview]')){
      const o=visible.find(x=>String(x.id)===el.dataset.preview);if(o)el.innerHTML=preview(o.customer_order_lines||[]);
    }
  }catch{ /* Images are optional; order data stays usable during a network failure. */ }
}
async function fetchAllOrders(){
  const all=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await supabase.from('customer_orders').select(`${ORDER_FIELDS}, customer_order_lines(item_id, qty_rolls)`).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499);
    if(error)throw error;all.push(...(data||[]));if(!data||data.length<500)break;
  }
  return all;
}
async function load(){
  const version=++loadVersion;$('btnReload').disabled=true;message();
  if(!loaded){$('ordersGrid').innerHTML='<div class="skeleton"></div>'.repeat(6);$('ordersGrid').setAttribute('aria-busy','true');$('emptyState').hidden=true;}
  try{
    const result=await fetchAllOrders();if(version!==loadVersion)return;
    orders=result;loaded=true;itemCache.clear();updateStats();render();
    const id=new URL(location.href).searchParams.get('id');
    if(id&&!dialog.open)await openOrder(id);
  }catch(error){
    if(version!==loadVersion)return;
    message(`تعذر تحديث الطلبات. ${friendly(error)}`,true);
    if(!loaded){$('ordersGrid').innerHTML='';$('ordersGrid').setAttribute('aria-busy','false');$('emptyState').hidden=false;$('emptyTitle').textContent='تعذر تحميل الطلبات';$('emptyText').textContent='تحقق من الاتصال ثم أعد المحاولة.';$('emptyAction').textContent='إعادة المحاولة';$('emptyAction').dataset.mode='retry';$('emptyAction').hidden=false;$('resultCount').textContent='لم يتم تحميل البيانات';}
  }finally{if(version===loadVersion)$('btnReload').disabled=false;}
}
async function fetchLines(id){
  const result=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await supabase.from('customer_order_lines').select('id, item_id, qty_rolls').eq('order_id',id).order('id').range(offset,offset+499);
    if(error)throw error;result.push(...(data||[]));if(!data||data.length<500)return result;
  }
}
async function freshOrder(id){const {data,error}=await supabase.from('customer_orders').select(ORDER_FIELDS).eq('id',id).maybeSingle();if(error)throw error;if(!data)throw new Error('الطلب غير موجود أو لم يعد متاحًا.');return data;}
function updateOrderCache(order,lines){const index=orders.findIndex(o=>String(o.id)===String(order.id));const value={...order,customer_order_lines:lines??orders[index]?.customer_order_lines??[]};if(index<0)orders.unshift(value);else orders[index]=value;updateStats();render();}
function setDetailActions(ready){
  for(const id of ['btnDownload','btnEdit','btnDelete','btnConfirm','btnExecute'])$(id).disabled=!ready||busy;
  for(const id of ['btnEdit','btnDelete','btnConfirm','btnExecute'])$(id).hidden=!canWrite;
  if(current){$('btnConfirm').hidden=!canWrite||statusOf(current)!=='draft';$('btnExecute').hidden=!canWrite||!['draft','confirmed'].includes(statusOf(current));}
}
async function openOrder(id){
  const version=++detailVersion;current=null;currentLines=[];message('',false,'detailMsg');setDetailActions(false);
  $('dTitle').textContent='جارٍ تحميل الطلب…';$('details').innerHTML='<div class="skeleton"></div>';
  if(!dialog.open)dialog.showModal();document.body.classList.add('orders-modal-open');
  const url=new URL(location.href);url.searchParams.set('id',id);history.replaceState(null,'',url);
  try{
    const [order,lines]=await Promise.all([freshOrder(id),fetchLines(id)]);
    const map=await itemsByIds(lines.map(l=>l.item_id));
    if(version!==detailVersion||!dialog.open)return;
    current=order;currentLines=lines;currentItems=map;renderDetails();setDetailActions(true);updateOrderCache(order,lines);
  }catch(error){if(version!==detailVersion)return;$('dTitle').textContent='تعذر فتح الطلب';$('details').innerHTML='<p class="subtle">يمكنك إغلاق النافذة وفتح الطلب مجددًا للمحاولة.</p>';message(friendly(error),true,'detailMsg');}
}
function renderDetails(){
  const order=current;$('dTitle').textContent=order.customer_name||'عميل بدون اسم';
  $('details').innerHTML=`<div id="snapshotArea"><div class="snapshot-brand">ADLATEX · ORDER #${esc(reference(order.id))}</div><div class="detail-meta">${badge(order)}<time>${esc(date(order.created_at))}</time></div><section class="detail-customer"><h3>${esc(order.customer_name||'عميل بدون اسم')}</h3>${phoneLink(order.customer_phone)}${order.note?`<p>${esc(order.note)}</p>`:''}</section><h3 class="detail-section-title">الخامات المطلوبة <span>${currentLines.length} صنف</span></h3>${currentLines.map(line=>{
    const it=currentItems.get(String(line.item_id)),url=it?.image_path?getPublicImageUrl(it.image_path):null;
    const photo=url?`<button class="product-photo" data-photo="${esc(url)}" aria-label="تكبير صورة ${esc(it.item_name||'الخامة')}"><img src="${esc(url)}" crossorigin="anonymous" alt="${esc(it.item_name||'الخامة')}" width="128" height="128" decoding="async"></button>`:'<div class="product-photo product-photo-placeholder">لا توجد صورة</div>';
    return `<div class="line-product">${photo}<div><h4>${esc(it?materialLabel(it):'مادة غير متاحة')}</h4><p>كود اللون: <bdi>${esc(it?.color_code||'—')}</bdi><br>${esc(it?.color_name||'')}</p></div><div class="line-quantity"><strong>${number.format(Number(line.qty_rolls)||0)}</strong><span>ثوب</span></div></div>`;
  }).join('')||'<p class="subtle">لا توجد أصناف في هذا الطلب.</p>'}<div class="detail-total"><span>إجمالي الأثواب المطلوبة</span><strong>${number.format(totalRolls(currentLines))} ثوب</strong></div></div><p class="workflow-note">${statusOf(order)==='executed'?'تم تحويل هذا الطلب إلى المبيعات. راجع سجل المبيعات للتحقق من الكميات المسجلة.':'تنفيذ الطلب يحوّله إلى صفحة المبيعات لإدخال الكميات الفعلية. لا تُسجّل حركة مخزون إلا عند حفظ المبيعات.'}</p>`;
}
function closeDetails(){if(busy)return;dialog.close();}
dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
dialog.addEventListener('close',()=>{++detailVersion;current=null;document.body.classList.remove('orders-modal-open');const url=new URL(location.href);url.searchParams.delete('id');history.replaceState(null,'',url);});
function ask(type){
  if(!canWrite||!current||busy)return;
  action={type,order:{...current},lines:currentLines.map(l=>({...l}))};
  const titles={edit:'تعديل بيانات الطلب',confirm:'تأكيد الطلب',execute:'تنفيذ الطلب وفتح المبيعات',delete:'حذف الطلب'};
  const texts={edit:'حدّث بيانات العميل والملاحظات الخاصة بهذا الطلب.',confirm:'سيصبح الطلب مؤكدًا وجاهزًا للتنفيذ.',execute:'سيُعلّم الطلب بأنه منفذ وتُفتح صفحة المبيعات في نفس النافذة. أدخل الكميات الفعلية واحفظها هناك لتسجيل حركة المخزون.',delete:'سيُحذف الطلب وبنوده نهائيًا. هذا الإجراء لا يحذف أي مبيعات مسجلة ولا يعيد كمياتها للمخزون.'};
  $('actionTitle').textContent=titles[type];$('actionText').textContent=texts[type];$('editFields').hidden=type!=='edit';$('editName').required=type==='edit';
  $('editName').value=current.customer_name||'';$('editPhone').value=current.customer_phone||'';$('editNote').value=current.note||'';
  $('saveAction').textContent=type==='edit'?'حفظ التعديلات':type==='delete'?'حذف نهائي':type==='execute'?'متابعة إلى المبيعات':'تأكيد الطلب';
  $('saveAction').className=`o-button ${type==='delete'?'o-danger':'o-primary'}`;message('',false,'actionMsg');$('actionDialog').showModal();
}
function matchStatus(query,order){return order.status==null?query.is('status',null):query.eq('status',order.status);}
async function mutate(order,values,remove=false){
  let query=remove?supabase.from('customer_orders').delete():supabase.from('customer_orders').update(values);
  query=matchStatus(query.eq('id',order.id),order);
  if(values?.customer_name!==undefined){for(const field of ['customer_name','customer_phone','note'])query=order[field]==null?query.is(field,null):query.eq(field,order[field]);}
  const {data,error}=await query.select(ORDER_FIELDS).maybeSingle();
  if(error)throw error;if(!data)throw new Error('تغيّر الطلب بواسطة مستخدم آخر أو لا تملك صلاحية تعديله. أغلق التفاصيل وافتح الطلب مجددًا.');return data;
}
async function submitAction(event){
  event.preventDefault();if(busy||!action)return;
  const task=action;
  if(task.type==='edit'&&!$('editName').value.trim()){message('أدخل اسم العميل.',true,'actionMsg');return;}
  busy=true;$('saveAction').disabled=true;$('cancelAction').disabled=true;setDetailActions(false);message('',false,'actionMsg');
  try{
    if(task.type==='execute'){
      const latest=await freshOrder(task.order.id),lines=await fetchLines(task.order.id);
      const itemIds=[...new Set(lines.map(l=>String(l.item_id)))];
      for(const id of itemIds)itemCache.delete(id);
      const available=await itemsByIds(itemIds);
      if(itemIds.some(id=>!available.get(id)?.is_active))throw new Error('يحتوي الطلب على مادة موقوفة أو غير متاحة. راجع المواد قبل التنفيذ.');
      await transferOrder({order:latest,lines,storage:localStorage,updateStatus:()=>mutate(latest,{status:'executed'}),navigate:url=>location.assign(url)});
      return;
    }
    if(task.type==='delete'){
      await mutate(task.order,null,true);orders=orders.filter(o=>o.id!==task.order.id);$('actionDialog').close();dialog.close();updateStats();render();message('تم حذف الطلب.');
    }else{
      const values=task.type==='confirm'?{status:'confirmed'}:{customer_name:$('editName').value.trim(),customer_phone:$('editPhone').value.trim()||null,note:$('editNote').value.trim()||null};
      const result=await mutate(task.order,values);current=result;updateOrderCache(result);renderDetails();$('actionDialog').close();message(task.type==='confirm'?'تم تأكيد الطلب.':'تم حفظ التعديلات.',false,'detailMsg');
    }
  }catch(error){message(friendly(error),true,'actionMsg');try{$('pendingSales').hidden=!localStorage.getItem(SALES_PREFILL_KEY);}catch{}}
  finally{busy=false;$('saveAction').disabled=false;$('cancelAction').disabled=false;setDetailActions(!!current);}
}
function loadImageLibrary(){
  if(window.html2canvas)return Promise.resolve(window.html2canvas);
  if(!imageLibraryPromise)imageLibraryPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    const timer=setTimeout(()=>{script.remove();imageLibraryPromise=null;reject(new Error('تعذر تحميل أداة الصور. أعد المحاولة أو تحقق من الاتصال.'));},15000);
    script.onload=()=>{clearTimeout(timer);resolve(window.html2canvas);};script.onerror=()=>{clearTimeout(timer);imageLibraryPromise=null;script.remove();reject(new Error('تعذر تحميل أداة الصور.'));};document.head.append(script);
  });return imageLibraryPromise;
}
async function download(){
  if(!current||busy)return;
  const order={...current},element=$('snapshotArea');busy=true;setDetailActions(false);message('جارٍ تجهيز صورة الطلب…',false,'detailMsg');
  try{
    const html2canvas=await loadImageLibrary();
    await Promise.all([...element.querySelectorAll('img')].map(img=>img.complete?Promise.resolve():new Promise(resolve=>{const timer=setTimeout(resolve,8000);const done=()=>{clearTimeout(timer);resolve();};img.addEventListener('load',done,{once:true});img.addEventListener('error',done,{once:true});})));
    const scale=Math.min(2,Math.sqrt(14000000/Math.max(1,element.scrollWidth*element.scrollHeight)));
    const canvas=await html2canvas(element,{scale,backgroundColor:'#ffffff',useCORS:true,allowTaint:false,logging:false,onclone:doc=>{const copy=doc.getElementById('snapshotArea');copy.style.background='#fff';const drawer=doc.getElementById('orderDialog');drawer.style.height='auto';drawer.style.maxHeight='none';drawer.style.overflow='visible';const body=doc.getElementById('details');body.style.overflow='visible';body.style.flex='none';}});
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('تعذر إنشاء الصورة.')),'image/png'));
    const fileName=`ADLATEX_order_${reference(order.id)}.png`,url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=fileName;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    const failed=[...element.querySelectorAll('img')].some(img=>!img.naturalWidth);message(failed?'تم تنزيل الصورة، لكن بعض صور الخامات لم تتحمل. أعد المحاولة إذا أردت تضمينها.':'تم تجهيز صورة الطلب للتنزيل.',false,'detailMsg');
  }catch(error){message(friendly(error),true,'detailMsg');}
  finally{busy=false;setDetailActions(!!current);}
}
function reset(){activeStatus='all';$('search').value='';$('period').value='all';$('sort').value='newest';page=1;syncTabs();render();}
function syncTabs(){for(const btn of $('statusTabs').querySelectorAll('button'))btn.setAttribute('aria-pressed',String(btn.dataset.status===activeStatus));}
$('statusTabs').addEventListener('click',e=>{const b=e.target.closest('[data-status]');if(!b)return;activeStatus=b.dataset.status;page=1;syncTabs();if(loaded)render();});
$('search').addEventListener('input',()=>{page=1;if(loaded)render();});
for(const id of ['period','sort'])$(id).addEventListener('change',()=>{page=1;if(loaded)render();});
$('resetFilters').addEventListener('click',reset);$('btnReload').addEventListener('click',load);
$('prevPage').addEventListener('click',()=>{page--;render();$('ordersGrid').scrollIntoView({block:'start'});});$('nextPage').addEventListener('click',()=>{page++;render();$('ordersGrid').scrollIntoView({block:'start'});});
$('emptyAction').addEventListener('click',()=>{const mode=$('emptyAction').dataset.mode;if(mode==='retry')load();else if(mode==='reset')reset();else location.assign('./preorders.html');});
$('ordersGrid').addEventListener('click',e=>{const b=e.target.closest('[data-open]');if(b)openOrder(b.dataset.open);});
$('closeDetails').addEventListener('click',closeDetails);
for(const [id,type] of [['btnEdit','edit'],['btnConfirm','confirm'],['btnExecute','execute'],['btnDelete','delete']])$(id).addEventListener('click',()=>ask(type));
$('btnDownload').addEventListener('click',download);$('actionForm').addEventListener('submit',submitAction);$('cancelAction').addEventListener('click',()=>$('actionDialog').close());
$('actionDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('details').addEventListener('click',e=>{const b=e.target.closest('[data-photo]');if(!b)return;$('largePhoto').src=b.dataset.photo;$('photoDialog').showModal();});$('closePhoto').addEventListener('click',()=>$('photoDialog').close());
$('newOrder').hidden=false;
try{const pending=JSON.parse(localStorage.getItem(SALES_PREFILL_KEY)||'null');$('pendingSales').hidden=!canWrite||!pending?.order_id;}catch{}
await load();
