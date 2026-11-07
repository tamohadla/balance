import {requireAccess} from './auth-guard.js?v=workspace-2';
import {supabase} from './supabaseClient.js?v=workspace-2';
import {$,escapeHtml as esc,explainSupabaseError} from './shared.js?v=workspace-2';
const access=await requireAccess();
if(access.member.role!=='admin')throw new Error('غير مسموح');
const entities={items:'المواد',stock_moves:'حركات المخزون',customer_orders:'الطلبات',customer_order_lines:'أصناف الطلبات',recon_sessions:'التسويات'};
const actions={insert:'إضافة',update:'تعديل',delete:'حذف'};
const fields={item_name:'المادة',main_category:'المجموعة الأساسية',sub_category:'المجموعة الفرعية',color_code:'رقم اللون',color_name:'اسم اللون',unit_type:'الوحدة',description:'الوصف',image_path:'الصورة',is_active:'نشطة',customer_name:'العميل',customer_phone:'الهاتف',status:'الحالة',note:'ملاحظات',qty_rolls:'الأثواب',qty_main_in:'الكمية الداخلة',qty_main_out:'الكمية الخارجة',qty_rolls_in:'الأثواب الداخلة',qty_rolls_out:'الأثواب الخارجة',move_date:'تاريخ الحركة',recon_date:'تاريخ التسوية',type:'نوع الحركة'};
const values={draft:'مسودة',confirmed:'مؤكد',pending_sale:'بانتظار المبيعات',executed:'منفذ',purchase:'شراء',sale:'بيع',adjustment:'تسوية',kg:'كغ',m:'متر'};
function value(v){return v===null||v===undefined?'—':v===true?'نعم':v===false?'لا':values[v]||String(v);}
let page=0,version=0;
function details(event){
 const before=event.before_data||{},after=event.after_data||{};
 const keys=Object.keys(fields).filter(k=>(k in before||k in after)&&(event.action!=='update'||JSON.stringify(before[k])!==JSON.stringify(after[k])));
 const title=after.item_name||before.item_name||after.customer_name||before.customer_name||'عرض التغييرات';
 return '<details><summary>'+esc(title)+'</summary>'+keys.map(k=>'<div><b>'+fields[k]+': </b>'+esc(value(before[k]))+' ← '+esc(value(after[k]))+'</div>').join('')+'<small>المرجع: <bdi>'+esc(event.record_id)+'</bdi></small></details>';
}
async function load(){
 const token=++version;$('eventsMsg').textContent='جارٍ التحميل…';
 for(const id of ['reloadEvents','prevEvents','nextEvents'])$(id).disabled=true;
 try{
 const from=$('eventFrom').value,to=$('eventTo').value;if(from&&to&&from>to)throw new Error('تاريخ البداية بعد النهاية.');
 let q=supabase.from('operation_events').select('id,created_at,actor_name,entity,record_id,action,before_data,after_data').order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*50,page*50+50);
 if($('eventEntity').value)q=q.eq('entity',$('eventEntity').value);if($('eventAction').value)q=q.eq('action',$('eventAction').value);
 if(from)q=q.gte('created_at',new Date(from+'T00:00:00').toISOString());
 if(to){const end=new Date(to+'T00:00:00');end.setDate(end.getDate()+1);q=q.lt('created_at',end.toISOString());}
 const {data,error}=await q;if(error)throw error;if(token!==version)return;
 $('eventsBody').innerHTML=data.slice(0,50).map(e=>'<tr><td>'+esc(new Date(e.created_at).toLocaleString('ar-EG'))+'</td><td>'+esc(e.actor_name||'مستخدم')+'</td><td>'+esc(entities[e.entity]||e.entity)+'</td><td>'+esc(actions[e.action]||e.action)+'</td><td>'+details(e)+'</td></tr>').join('');
 $('eventsMsg').textContent=data.length?'':'لا توجد عمليات مطابقة.';$('eventsPage').textContent='صفحة '+(page+1);$('nextEvents').disabled=data.length<=50;
 }catch(e){if(token===version)$('eventsMsg').textContent=e.code?explainSupabaseError(e):e.message;}
 finally{if(token===version){$('reloadEvents').disabled=false;$('prevEvents').disabled=page===0;}}
}
$('reloadEvents').onclick=()=>{page=0;load();};$('clearEvents').onclick=()=>{for(const id of ['eventEntity','eventAction','eventFrom','eventTo'])$(id).value='';page=0;load();};
$('prevEvents').onclick=()=>{if(page>0){page--;load();}};$('nextEvents').onclick=()=>{page++;load();};
await load();
