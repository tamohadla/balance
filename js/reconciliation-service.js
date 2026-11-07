import {supabase} from './supabaseClient.js?v=permissions-1';
export function reconciliationError(error){
  const message=error?.message||'';
  if(message.includes('RECON_STOCK_CHANGED'))return 'تغيّر الرصيد منذ تحميل الجرد. حدّث الأرصدة وراجع الكميات الفعلية ثم أعد الاعتماد.';
  if(message.includes('RECON_REQUEST_CONFLICT'))return 'تعارضت محاولة الحفظ. راجع سجل التسويات قبل المحاولة مجددًا.';
  if(message.includes('INVALID_RECON'))return 'راجع الكميات: الفعلي غير سالب، والأثواب عدد صحيح.';
  if(message.includes('RECON_ACCESS_DENIED'))return 'لا تملك صلاحية اعتماد التسويات.';
  return message||'لم نتأكد من الحفظ. استخدم استكمال التسوية للتحقق دون تكرار.';
}
export function createReconciliationClient({userId,scope,storage=localStorage,rpc=(request)=>supabase.rpc('save_reconciliation',request),uuid=()=>crypto.randomUUID()}){
  const key='reconciliation-pending:'+userId+':'+scope;
  let busy=false;
  function pending(){const value=storage.getItem(key);return value?JSON.parse(value):null;}
  async function send(request){
    if(busy)throw new Error('جارٍ اعتماد التسوية بالفعل.');
    busy=true;
    try{
      const {data,error}=await rpc(request);
      if(error)throw error;
      if(data!==request.p_id)throw new Error('لم نتأكد من نتيجة الحفظ. استخدم استكمال التسوية.');
      storage.removeItem(key);
      return data;
    }catch(error){
      if(/RECON_STOCK_CHANGED|INVALID_RECON|RECON_ACCESS_DENIED/.test(error?.message||'')||['22P02','22003','23503','23514','42501'].includes(error?.code))storage.removeItem(key);
      throw error;
    }finally{busy=false;}
  }
  return {pending,
    async save(date,lines){
      const request={p_date:date,p_lines:lines};
      const previous=pending();
      if(previous&&(previous.p_date!==date||JSON.stringify(previous.p_lines)!==JSON.stringify(lines)))throw new Error('توجد محاولة تسوية سابقة لم تُحسم. اضغط استكمال التسوية أولًا.');
      const saved=previous||{p_id:uuid(),...request};
      storage.setItem(key,JSON.stringify(saved));
      return send(saved);
    },
    async recover(){const saved=pending();if(!saved)throw new Error('لا توجد تسوية معلقة.');return send(saved);}
  };
}
export function mountReconciliationRecovery(client,msg,afterSave){
  const bar=document.createElement('div');bar.className='card';
  const text=document.createElement('span');text.textContent='توجد محاولة تسوية لم نتأكد من حفظها. ';
  const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='استكمال التسوية';
  bar.append(text,button);msg.before(bar);
  function refresh(){try{bar.hidden=!client.pending();}catch{bar.hidden=true;msg.textContent='تعذر قراءة محاولة التسوية المحفوظة في المتصفح.';}}
  button.onclick=async()=>{button.disabled=true;try{await client.recover();await afterSave();msg.textContent='تم التحقق من حفظ التسوية بنجاح.';}catch(e){msg.textContent=reconciliationError(e);}finally{button.disabled=false;refresh();}};
  refresh();return refresh;
}
