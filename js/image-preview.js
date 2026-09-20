import {supabase} from './supabaseClient.js';
import {getPublicImageUrl,escapeHtml as esc} from './shared.js';
const $=id=>document.getElementById(id);
const SAMPLE='5cc26fe0-51de-49c2-bf89-e5e174b89e11';
let variants=[],busy=false;
function info(){const size=Number($('displaySize').value),dpr=window.devicePixelRatio||1;$('previewGrid').style.setProperty('--photo-size',size+'px');$('screenInfo').textContent=`الصورة المعروضة: ${size} بكسل × كثافة الشاشة ${dpr.toFixed(1)} ≈ ${Math.round(size*dpr)} بكسل فعلي. الأبعاد المذكورة على البطاقات تخص أكبر ضلع في الملف.`;}
async function reduced(source,maxSide){
 const scale=Math.min(1,maxSide/Math.max(source.naturalWidth,source.naturalHeight));
 const width=Math.max(1,Math.round(source.naturalWidth*scale)),height=Math.max(1,Math.round(source.naturalHeight*scale));
 // Progressive resampling limits aliasing of tightly repeated textile lines.
 let input=source,w=source.naturalWidth,h=source.naturalHeight;
 while(w/2>=width&&h/2>=height){const c=document.createElement('canvas');c.width=Math.max(width,Math.round(w/2));c.height=Math.max(height,Math.round(h/2));const ctx=c.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(input,0,0,c.width,c.height);input=c;w=c.width;h=c.height;}
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(input,0,0,width,height);
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('تعذر تجهيز النسخة المصغرة.')),'image/jpeg',.9));return {blob,width,height};
}
async function load(){if(busy)return;busy=true;$('reloadPreview').disabled=true;$('previewError').textContent='جارٍ تحميل الصورة وتجهيز المقارنة…';try{
 const {data:item,error}=await supabase.from('items').select('id,item_name,color_code,color_name,image_path').eq('id',SAMPLE).single();if(error)throw error;if(!item?.image_path)throw new Error('صورة عينة الريب غير متاحة.');
 const response=await fetch(getPublicImageUrl(item.image_path,Date.now()));if(!response.ok)throw new Error('تعذر تحميل الصورة.');const original=await response.blob(),source=new Image(),sourceUrl=URL.createObjectURL(original);source.src=sourceUrl;
 let next=[];try{await source.decode();next.push({label:'الصورة الحالية',caption:'ملف الصورة الموجود بالموقع',blob:original,width:source.naturalWidth,height:source.naturalHeight});for(const size of [200,400])next.push({label:`نسخة ${size} بكسل`,caption:'JPEG · جودة 90% · تصغير متدرج',...await reduced(source,size)});}finally{URL.revokeObjectURL(sourceUrl);}
 for(const v of variants)URL.revokeObjectURL(v.url);variants=next.map(v=>({...v,url:URL.createObjectURL(v.blob)}));
 $('sampleName').textContent=`${item.item_name} · ${item.color_code} · ${item.color_name||''}`;
 $('previewGrid').innerHTML=variants.map((v,i)=>`<article class="preview-card"><h2>${v.label}</h2><small>${v.caption}</small><img class="preview-photo" src="${v.url}" alt="${esc(item.item_name)} — ${v.label}"><strong>${v.width} × ${v.height} بكسل</strong><small>${(v.blob.size/1024).toFixed(1)} KB${i?` · أقل حجمًا ${Math.round((1-v.blob.size/original.size)*100)}%`:''}</small><button class="secondary" data-zoom="${i}">فحص هذه النسخة</button><br><a href="${v.url}" download="ADLATEX_rib_fleece_C02_${i?[200,400][i-1]:'current'}.jpg">تنزيل النسخة</a></article>`).join('');$('previewError').textContent='';info();
 }catch(e){$('previewError').textContent='تعذرت التجربة: '+(e.message||'تحقق من الاتصال وأعد المحاولة.');}finally{busy=false;$('reloadPreview').disabled=false;}}
$('previewGrid').onclick=e=>{const b=e.target.closest('[data-zoom]');if(!b)return;const v=variants[Number(b.dataset.zoom)];$('zoomImage').src=v.url;$('zoomLabel').textContent=v.label+' — '+v.width+' × '+v.height;$('previewZoom').showModal();};$('closePreviewZoom').onclick=()=>$('previewZoom').close();$('displaySize').onchange=info;$('reloadPreview').onclick=load;window.addEventListener('resize',info);await load();
