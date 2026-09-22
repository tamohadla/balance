export const SECTIONS = [
 ['dashboard','الرئيسية والتلخيص'],['items','المواد والمجموعات والصور'],
 ['inventory','المخزون وحركة المادة'],['purchases','المشتريات والاستيراد'],
 ['sales','المبيعات والاستيراد'],['orders','الطلبات'],['adjustments','التسويات']
];
export const ROLE_LABELS={admin:'أدمن',assistant:'مساعد أدمن',viewer:'عرض وإنشاء طلبات'};
export const PAGE_SECTIONS={
 'index.html':'dashboard','items.html':'items','item-groups.html':'items','image-preview.html':'items','color-names.html':'items','import-printed.html':'items','import-v2.html':'items',
 'inventory.html':'inventory','purchases.html':'purchases','purchases-review.html':'purchases','purchases-import-review.html':'purchases',
 'sales.html':'sales','sales-review.html':'sales','sales-import-review.html':'sales','preorders.html':'orders','orders.html':'orders',
 'reconciliation.html':'adjustments','adjustments.html':'adjustments'
};
export function canView(member,section){return !!member?.is_active&&(member.role==='admin'||member.role==='viewer'&&['inventory','orders'].includes(section)||member.role==='assistant'&&['read','manage'].includes(member.permissions?.[section]));}
export function canManage(member,section){return !!member?.is_active&&(member.role==='admin'||member.role==='assistant'&&member.permissions?.[section]==='manage');}
export function canCreateOrder(member){return canManage(member,'orders')||member?.is_active&&member.role==='viewer';}
export function canAccessPage(member,page){
 if(!member?.is_active)return false;
 if(page==='account.html')return true;
 if(page==='users.html')return member.role==='admin';
 if(['import-batches.html','import-batch-details.html'].includes(page))return canView(member,'purchases')||canView(member,'sales');
 if(page==='preorders.html')return canCreateOrder(member);
 if(['purchases.html','sales.html','import-printed.html','import-v2.html'].includes(page))return canManage(member,PAGE_SECTIONS[page]);
 return !!PAGE_SECTIONS[page]&&canView(member,PAGE_SECTIONS[page]);
}
export function homePage(member){return ['index.html','inventory.html','orders.html','items.html','purchases-review.html','sales-review.html','adjustments.html'].find(p=>canAccessPage(member,p))||'account.html';}
