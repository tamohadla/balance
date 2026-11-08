import {customerDemoUrl,linkMessage} from './order-demo-data.js?v=1';
import {whatsappLink} from './whatsapp-order-model.js?v=1';
const $=id=>document.getElementById(id),link=customerDemoUrl(location.href);
$('preview').href=link;$('link').value=link;$('message').value=linkMessage(link);
const phone=new URLSearchParams(location.hash.slice(1)).get('phone');if(phone){$('phone').value=phone.slice(0,40);history.replaceState(null,'',location.pathname+location.search);}
$('copyLink').onclick=async()=>{try{await navigator.clipboard.writeText(link);$('copyFeedback').textContent='تم نسخ الرابط.';$('copyFeedback').dataset.error='false';}catch{$('link').focus();$('link').select();$('copyFeedback').textContent='حددنا الرابط؛ انسخه يدوياً.';}};
$('send').onsubmit=e=>{e.preventDefault();try{const url=whatsappLink($('phone').value,$('message').value);const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';document.body.append(a);a.click();a.remove();$('feedback').textContent='تم طلب فتح واتساب. اضغط إرسال داخل المحادثة.';$('feedback').dataset.error='false';}catch(error){$('feedback').textContent=error.message;$('feedback').dataset.error='true';$('phone').focus();}};
