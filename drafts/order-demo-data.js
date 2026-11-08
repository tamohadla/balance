// Public, fictional presentation data. This demo token is NOT an access credential.
export const DEMO_TOKEN='demo-adlatex-001';
export const demoOrder={reference:'DEMO-001',customer:'عميل تجريبي',date:'08 / 11 / 2026',note:'يرجى مراجعة الأصناف والألوان وعدد الأثواب، والرد على رسالة واتساب لتأكيد التفاصيل.',lines:[
 {name:'ريب فليس',category:'خامات شتوية',color:'زيتي',code:'10',qty:12,image:'./samples/olive.svg'},
 {name:'ريب فليس',category:'خامات شتوية',color:'مينت',code:'20',qty:6,image:'./samples/mint.svg'},
 {name:'ميلتون',category:'خامات شتوية',color:'كريمي',code:'03',qty:4,image:'./samples/cream.svg'}
]};
export function totalRolls(order=demoOrder){return order.lines.reduce((sum,line)=>sum+line.qty,0);}
export function customerDemoUrl(base){const url=new URL('./customer-order.html',base);url.hash=new URLSearchParams({demo:DEMO_TOKEN}).toString();return url.href;}
export function linkMessage(url){return ['*عدلة تكس | ADLATEX*','مرحباً،','يمكنك مراجعة تفاصيل الطلب وصور الأصناف من خلال الرابط التالي:',url,'',`رقم الطلب: ${demoOrder.reference}`,`إجمالي الأثواب: ${totalRolls()}`,'يرجى مراجعة التفاصيل والرد على هذه الرسالة لتأكيدها.','','هذه تجربة ببيانات وهمية وليست طلباً فعلياً.'].join('\n');}
