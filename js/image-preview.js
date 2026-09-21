import {supabase} from './supabaseClient.js';
import {getPublicImageUrl,escapeHtml as esc} from './shared.js?v=200-1';
const $=id=>document.getElementById(id);
const SAMPLE='5cc26fe0-51de-49c2-bf89-e5e174b89e11';
let variants=[],busy=false;
function info(){const size=Number($('displaySize').value),dpr=window.devicePixelRatio||1;$('previewGrid').style.setProperty('--photo-size',size+'px');$('screenInfo').textContent=`الصورة المعروضة: ${size} بكسل × كثافة الشاشة ${dpr.toFixed(1)} ≈ ${Math.round(size*dpr)} بكسل فعلي. الأبعاد المذكورة على البطاقات تخص أكبر ضلع في الملف.`;}
// Explicit pixel smoothing also works on mobile browsers without canvas filters.
function prepare(source, {square=false, close=false, radius=0}={}){
 const w=source.naturalWidth,h=source.naturalHeight;
 const side=Math.round(Math.min(w,h)*(close ? .60 : 1));
 const c=document.createElement('canvas');c.width=square?side:w;c.height=square?side:h;
 const ctx=c.getContext('2d',{alpha:false});
 ctx.drawImage(source,square?(w-side)/2:0,square?(h-side)/2:0,c.width,c.height,0,0,c.width,c.height);
 if(radius){
  const pixels=ctx.getImageData(0,0,c.width,c.height),width=c.width,height=c.height;
  let input=pixels.data;
  // Two separable box passes approximate a soft low-pass filter before reduction.
  for(let pass=0;pass<2;pass++)for(const horizontal of [true,false]){
   const output=new Uint8ClampedArray(input.length),length=horizontal?width:height,lines=horizontal?height:width;
   for(let line=0;line<lines;line++)for(let channel=0;channel<4;channel++){
    const index=pos=>((horizontal?line*width+pos:pos*width+line)*4+channel);
    let sum=0;for(let k=-radius;k<=radius;k++)sum+=input[index(Math.max(0,Math.min(length-1,k)))];
    for(let pos=0;pos<length;pos++){
     output[index(pos)]=sum/(radius*2+1);
     sum-=input[index(Math.max(0,pos-radius))];sum+=input[index(Math.min(length-1,pos+radius+1))];
    }
   }
   input=output;
  }
  pixels.data.set(input);ctx.putImageData(pixels,0,0);
 }
 return c;
}
async function reduced(source,maxSide){
 const sw=source.naturalWidth||source.width,sh=source.naturalHeight||source.height;
 const scale=Math.min(1,maxSide/Math.max(sw,sh));
 const width=Math.max(1,Math.round(sw*scale)),height=Math.max(1,Math.round(sh*scale));
 let input=source,w=sw,h=sh;
 const draw=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(input,0,0,w,h);return c;};
 while(w/2>=width&&h/2>=height){w=Math.max(width,Math.round(w/2));h=Math.max(height,Math.round(h/2));input=draw(w,h);}
 const canvas=draw(width,height);
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('تعذر تجهيز النسخة.')),'image/jpeg',.9));return {blob,width,height};
}
async function load(){if(busy)return;busy=true;$('reloadPreview').disabled=true;$('displaySize').disabled=true;$('previewError').textContent='جارٍ تحميل الصورة وتجهيز المقارنة…';try{
 const {data:item,error}=await supabase.from('items').select('id,item_name,color_code,color_name,image_path').eq('id',SAMPLE).single();if(error)throw error;if(!item?.image_path)throw new Error('صورة عينة الريب غير متاحة.');
 const response=await fetch(getPublicImageUrl(item.image_path,Date.now()));if(!response.ok)throw new Error('تعذر تحميل الصورة.');const original=await response.blob(),source=new Image(),sourceUrl=URL.createObjectURL(original);source.src=sourceUrl;
 let next=[];try{
  await source.decode();
  const target=Math.round(Number($('displaySize').value)*(window.devicePixelRatio||1));
  const light=Math.max(1,Math.round(Math.max(source.naturalWidth,source.naturalHeight)/400));
  const choices=[
   {label:'1 · المصغّرة الحالية',caption:'مرجع المقارنة · كامل الصورة · أكبر ضلع 200',size:200,options:{}},
   {label:'2 · تنعيم خفيف',caption:'نفس الأبعاد · تقليل التموج قبل التصغير',size:200,options:{radius:light}},
   {label:'3 · تنعيم أقوى',caption:'تقليل أكبر للتموج · قد تفقد تفاصيل دقيقة',size:200,options:{radius:light*2}},
   {label:'4 · مربع 200',caption:'قص مركزي مربع · دون تنعيم إضافي',size:200,options:{square:true}},
   {label:'5 · مطابق لشاشتك',caption:`قص مركزي مربع · هدف ${target} بكسل حسب حجم العرض وكثافة الشاشة`,size:target,options:{square:true}},
   {label:'6 · لقطة أقرب',caption:'وسط القماش بتقريب 1.7× · مع تنعيم خفيف · يخفي الأطراف',size:200,options:{square:true,close:true,radius:light}}
  ];
  for(const choice of choices)next.push({...choice,...await reduced(prepare(source,choice.options),choice.size)});
 }finally{URL.revokeObjectURL(sourceUrl);}
 $('previewZoom').close();
 for(const v of variants)URL.revokeObjectURL(v.url);variants=next.map(v=>({...v,url:URL.createObjectURL(v.blob)}));
 $('sampleName').textContent=`${item.item_name} · ${item.color_code} · ${item.color_name||''}`;
 $('previewGrid').innerHTML=variants.map((v,i)=>`<article class="preview-card"><h2>${v.label}</h2><small>${v.caption}</small><img class="preview-photo" src="${v.url}" alt="${esc(item.item_name)} — ${v.label}"><strong>${v.width} × ${v.height} بكسل</strong><small>${(v.blob.size/1024).toFixed(1)} KB · JPEG 90%</small><button class="secondary" data-zoom="${i}">فحص هذه النسخة</button><br><a href="${v.url}" download="ADLATEX_rib_fleece_C02_option_${i+1}.jpg">تنزيل النسخة</a></article>`).join('');$('previewError').textContent='';info();
 }catch(e){$('previewError').textContent='تعذرت التجربة: '+(e.message||'تحقق من الاتصال وأعد المحاولة.');}finally{busy=false;$('reloadPreview').disabled=false;$('displaySize').disabled=false;}}
$('previewGrid').onclick=e=>{const b=e.target.closest('[data-zoom]');if(!b)return;const v=variants[Number(b.dataset.zoom)];$('zoomImage').src=v.url;$('zoomLabel').textContent=v.label+' — '+v.width+' × '+v.height;$('previewZoom').showModal();};$('closePreviewZoom').onclick=()=>$('previewZoom').close();$('displaySize').onchange=()=>{info();load();};$('reloadPreview').onclick=load;window.addEventListener('resize',info);await load();
