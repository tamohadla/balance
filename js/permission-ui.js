import {canAccessPage,canManage,PAGE_SECTIONS} from './permissions.js?v=1';
export function applyPermissionUI(member){
 const page=location.pathname.split('/').pop()||'index.html',section=PAGE_SECTIONS[page];
 const write=section?canManage(member,section):canManage(member,'purchases')||canManage(member,'sales');
 const known=new Set([...Object.keys(PAGE_SECTIONS),'users.html','account.html','import-batches.html','import-batch-details.html']);
 const selectors={
 'items.html':'#itemForm,#btnBulk,#itemsTbody [data-act],#editItemForm,#bulkApply',
 'item-groups.html':'[data-group],#applyGroup',
 'color-names.html':'#btnReview,#btnApply,#tbody input',
 'reconciliation.html':'#btnSave,#tbody input',
 'purchases-import-review.html':'#tbody [data-act],#btnUpload,#btnRecheck,#btnDetectDup,#btnApproveReady,#btnApproveFinal,#btnDeleteBatch',
 'sales-import-review.html':'#tbody [data-act],#btnUpload,#btnRecheck,#btnDetectDup,#btnApproveReady,#btnApproveFinal,#btnDeleteBatch'
 };
 let pending=false;
 function update(){if(pending)return;pending=true;queueMicrotask(()=>{pending=false;
  for(const a of document.querySelectorAll('a[href]')){let u;try{u=new URL(a.href,location.href);}catch{continue;}const name=u.pathname.split('/').pop();if(u.origin===location.origin&&known.has(name)&&!canAccessPage(member,name))a.style.display='none';}
  if(!write&&selectors[page])for(const el of document.querySelectorAll(selectors[page])){if(el.matches('input,select,textarea,button'))el.disabled=true;else el.style.display='none';}
 });}
 new MutationObserver(update).observe(document.body,{subtree:true,childList:true});update();
 if(section&&!write&&member.role==='assistant'){
  const note=document.createElement('p');note.textContent='صلاحيتك في هذا القسم: عرض فقط';note.style.cssText='padding:10px 20px;margin:12px;background:#edf5fa;color:#294c61;border-radius:10px';document.querySelector('main')?.prepend(note);
 }
}
