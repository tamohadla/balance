import {imageUrlWithRevision} from './image-cache.js?v=224-1';
let host, dialog, photo, stage, canvas, status, caption, zoomButton, scale=1, fitWidth=0, fitHeight=0, previousOverflow='', opener;
function fullUrl(value){
 if(!value)return '';
 try{const url=new URL(value,location.href);if(!['https:','http:','blob:','data:'].includes(url.protocol))return '';url.pathname=url.pathname.replace(/\.thumb-(200|224)\.jpg$/,'');return imageUrlWithRevision(url.href);}catch{return '';}
}
function layout(reset=false){
 if(!photo.naturalWidth)return;
 if(reset)scale=1;
 const ratio=Math.min((stage.clientWidth-32)/photo.naturalWidth,(stage.clientHeight-32)/photo.naturalHeight,1);
 fitWidth=photo.naturalWidth*ratio;fitHeight=photo.naturalHeight*ratio;
 photo.style.width=`${fitWidth*scale}px`;photo.style.height=`${fitHeight*scale}px`;
 canvas.style.minWidth=`${fitWidth*scale+32}px`;canvas.style.minHeight=`${fitHeight*scale+32}px`;
 zoomButton.textContent=scale===1?'تكبير +':'ملاءمة الشاشة';zoomButton.disabled=false;
 stage.style.cursor=scale>1?'grab':'default';
 if(reset){stage.scrollLeft=0;stage.scrollTop=0;}
}
function build(){
 host=document.createElement('div');host.id='site-image-viewer';
 const root=host.attachShadow({mode:'open'});
 root.innerHTML=`<style>
 :host{color-scheme:dark}*{box-sizing:border-box}dialog{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:rgba(12,18,25,.97);color:#fff;font:14px system-ui;overflow:hidden}dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#101820dd}
 header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding: max(12px,env(safe-area-inset-top)) 20px 12px;flex-shrink:0;border-bottom:1px solid #ffffff17;direction:rtl}p{margin:0;line-height:1.6;overflow-wrap:anywhere}header p{max-width:70%;max-height:4.8em;overflow:auto}nav{display:flex;gap:8px;flex-shrink:0}button{font:600 14px system-ui;cursor:pointer;min-height:44px;min-width:44px;padding:8px 14px;border:1px solid #ffffff35;border-radius:12px;background:#ffffff12;color:#fff}button:hover{background:#ffffff25}button:focus-visible{outline:3px solid #71d8d0;outline-offset:3px}button:disabled{opacity:.4}
 .stage{flex:1;min-height:0;overflow:auto;direction:ltr;overscroll-behavior:contain}.canvas{width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:16px;position:relative}img{display:block;max-width:none;max-height:none;object-fit:contain;border-radius:6px;user-select:none;-webkit-user-drag:none;flex-shrink:0}img[hidden]{display:none}.status{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;text-align:center;padding:24px}.status:empty{display:none}footer{text-align:center;color:#ffffff99;font-size:12px;padding:8px 16px max(12px,env(safe-area-inset-bottom));flex-shrink:0}@media(max-width:600px){header{padding-left:12px;padding-right:12px}header p{font-size:12px}nav{gap:6px}button{font-size:12px;padding:8px 10px}footer{font-size:11px}}
 </style><dialog aria-label="عرض صورة الخامة"><header><p id="caption"></p><nav><button id="zoom" type="button" disabled>تكبير +</button><button id="close" type="button" aria-label="إغلاق الصورة">✕</button></nav></header><div class="stage"><div class="canvas"><img alt="" hidden draggable="false"><p class="status" role="status"></p></div></div><footer>اضغط خارج الصورة للإغلاق · Esc على الكمبيوتر · بعد التكبير اسحب لاستعراض التفاصيل</footer></dialog>`;
 document.body.append(host);dialog=root.querySelector('dialog');photo=root.querySelector('img');stage=root.querySelector('.stage');canvas=root.querySelector('.canvas');status=root.querySelector('.status');caption=root.querySelector('#caption');zoomButton=root.querySelector('#zoom');
 dialog.addEventListener('keydown',e=>e.stopPropagation());
 root.querySelector('#close').onclick=()=>dialog.close();
 zoomButton.onclick=()=>{scale=scale===1?2:1;layout(scale===1);};
 photo.onload=()=>{photo.hidden=false;status.textContent='';layout(true);};
 photo.onerror=()=>{photo.hidden=true;status.textContent='تعذر تحميل الصورة. أغلقها وأعد المحاولة.';zoomButton.disabled=true;};
 dialog.addEventListener('close',()=>{document.documentElement.style.overflow=previousOverflow;photo.removeAttribute('src');opener?.focus?.({preventScroll:true});});
 stage.addEventListener('click',e=>{if(scale===1&&(e.target===stage||e.target===canvas))dialog.close();});
 let drag;
 stage.addEventListener('pointerdown',e=>{if(scale===1||e.pointerType!=='mouse'||e.button!==0)return;drag={x:e.clientX,y:e.clientY,left:stage.scrollLeft,top:stage.scrollTop};stage.setPointerCapture(e.pointerId);stage.style.cursor='grabbing';e.preventDefault();});
 stage.addEventListener('pointermove',e=>{if(!drag)return;stage.scrollLeft=drag.left+drag.x-e.clientX;stage.scrollTop=drag.top+drag.y-e.clientY;});
 const end=()=>{drag=null;stage.style.cursor=scale>1?'grab':'default';};stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',end);
 window.addEventListener('resize',()=>{if(dialog.open)layout(true);});
}
export function openImageViewer(url,label='معاينة الخامة'){
 url=fullUrl(url);if(!url)return;
 if(!host)build();opener=document.activeElement;caption.textContent=label;photo.alt=label;photo.hidden=true;status.textContent='جارٍ تحميل الصورة…';zoomButton.disabled=true;scale=1;
 if(!dialog.open){previousOverflow=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';dialog.showModal();}
 photo.src=url;
}
function candidate(target){
 const img=target.closest?.('img')||target.closest?.('[data-photo]')?.querySelector('img');
 if(!img||img.closest('#site-image-viewer')||img.closest('[role="option"]'))return null;
 const url=img.dataset.full||img.dataset.thumbnailUrl||img.currentSrc||img.src;
 return img.matches('.thumb,[data-full]')||img.closest('[data-photo]')||url.includes('/storage/v1/object/public/item-images/')?{img,url}:null;
}
document.addEventListener('click',e=>{const found=candidate(e.target);if(!found)return;e.preventDefault();e.stopImmediatePropagation();openImageViewer(found.url,found.img.alt&&found.img.alt!=='img'?found.img.alt:'معاينة الخامة');},true);
document.addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key))return;const found=candidate(e.target);if(!found||e.target.tagName!=='IMG')return;e.preventDefault();e.stopImmediatePropagation();openImageViewer(found.url,found.img.alt||'معاينة الخامة');},true);
let queued=false;
function decorate(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;for(const img of document.querySelectorAll('img')){if(!candidate(img))continue;img.style.cursor='zoom-in';if(!img.closest('button,a')&&!img.hasAttribute('tabindex')){img.tabIndex=0;img.setAttribute('role','button');img.setAttribute('aria-label','تكبير الصورة');}}});}
new MutationObserver(decorate).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});decorate();
