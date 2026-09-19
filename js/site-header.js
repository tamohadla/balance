const mainLinks = [
  ['index.html','الرئيسية','⌂'],['items.html','المواد','▦'],
  ['inventory.html','المخزون','▤'],['purchases.html','المشتريات','↓'],['sales.html','المبيعات','↑']
];
const groups = [
  ['الطلبات',[['preorders.html','إنشاء طلب'],['orders.html','متابعة الطلبات']]],
  ['التسويات',[['reconciliation.html','التسوية الشهرية'],['adjustments.html','سجل التسويات']]],
  ['أدوات واستيراد',[['import-batches.html','استيراد المشتريات والمبيعات'],['import-printed.html','استيراد المواد المطبوعة'],['color-names.html','أسماء الألوان']]]
];
export function buildHeader(access, logout) {
  const current=location.pathname.split('/').pop()||'index.html';
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text)node.textContent=text;return node;};
  const link=(href,text,cls)=>{const a=el('a',cls,text);a.href=href;if(current===href)a.setAttribute('aria-current','page');return a;};
  const header=el('header','site-header');
  const top=el('div','site-header__top');
  const brand=link('index.html','','site-brand');brand.setAttribute('aria-label','Balance — الرئيسية');
  brand.append(el('span','site-brand__mark','B'));const title=el('span');title.append(el('strong','','BALANCE'),el('small','','إدارة المخزون والعمليات'));brand.append(title);
  const actions=el('div','site-header__account');const user=el('span','site-user',access.member.display_name||access.user.email||'حسابي');
  user.append(el('small','',access.member.role==='admin'?'مدير النظام':'عرض وإنشاء طلبات'));
  actions.append(user,link('account.html','حسابي','site-action'));
  if(access.member.role==='admin')actions.append(link('users.html','إدارة الحسابات','site-action'));
  logout.className='site-action site-action--logout';actions.append(logout);
  const toggle=el('button','site-action site-menu-toggle','☰ الأقسام');toggle.type='button';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','site-navigation');
  top.append(brand,toggle,actions);
  const wrap=el('div','site-header__nav-wrap'),nav=el('nav','site-nav');wrap.id='site-navigation';nav.setAttribute('aria-label','التنقل الرئيسي');
  toggle.addEventListener('click',()=>{const open=wrap.classList.toggle('is-open');toggle.setAttribute('aria-expanded',String(open));});
  for(const [href,text,icon] of mainLinks){const a=link(href,'','site-nav__link');const i=el('span','site-nav__icon',icon);i.setAttribute('aria-hidden','true');a.append(i,el('span','',text));nav.append(a);}
  for(const [title,links] of groups){const details=el('details');const summary=el('summary','',title),menu=el('div','site-nav__menu');
    for(const [href,text] of links){menu.append(link(href,text,'site-nav__link'));if(current===href)details.classList.add('has-current');}
    details.append(summary,menu);details.addEventListener('toggle',()=>{if(details.open)nav.querySelectorAll('details').forEach(d=>{if(d!==details)d.open=false;});});nav.append(details);
  }
  header.addEventListener('keydown',event=>{if(event.key==='Escape')header.querySelectorAll('details[open]').forEach(d=>{d.open=false;d.querySelector('summary').focus();});});
  document.addEventListener('click',event=>{if(!header.contains(event.target))header.querySelectorAll('details[open]').forEach(d=>{d.open=false;});});
  wrap.append(nav);const error=el('p','site-header__error');error.setAttribute('role','status');header.append(top,wrap,error);
  document.body.prepend(header);
  document.querySelectorAll('nav.page-nav').forEach(n=>n.remove());
  return error;
}
