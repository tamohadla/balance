// Shared browser-wide image revision. Does not clear login, carts or other storage.
export const IMAGE_REVISION_KEY='balance:item-images:revision:v1';
export function reviseImageUrl(url,revision){
 if(!url||!revision)return url;
 try{const parsed=new URL(url,globalThis.location?.href);if(!['http:','https:'].includes(parsed.protocol))return url;parsed.searchParams.set('image_revision',revision);return parsed.href;}catch{return url;}
}
const REPLACEMENTS_KEY='balance:item-images:replacements:v1';
let replacements={};
function readReplacements(){try{replacements=JSON.parse(localStorage.getItem(REPLACEMENTS_KEY)||'{}');}catch{replacements={};}}
readReplacements();
function currentImageUrl(url){
 try{
  const u=new URL(url,globalThis.location?.href), marker='/storage/v1/object/public/item-images/';
  const index=u.pathname.indexOf(marker);if(index<0)return url;
  let path=decodeURIComponent(u.pathname.slice(index+marker.length));
  const suffix='.thumb-200.jpg',isThumb=path.endsWith(suffix);
  if(isThumb)path=path.slice(0,-suffix.length);
  const visited=new Set();
  while(replacements[path]&&!visited.has(path)){visited.add(path);path=replacements[path];}
  if(!visited.size)return url;
  u.pathname=u.pathname.slice(0,index+marker.length)+path+(isThumb?suffix:'');return u.href;
 }catch{return url;}
}
export function recordImageReplacement(previousPath,nextPath){
 if(!previousPath||previousPath===nextPath)return;
 readReplacements();replacements[previousPath]=nextPath;
 const entries=Object.entries(replacements).slice(-200);replacements=Object.fromEntries(entries);
 try{localStorage.setItem(REPLACEMENTS_KEY,JSON.stringify(replacements));}catch{}
 schedule();
}
let revision='';
try{revision=localStorage.getItem(IMAGE_REVISION_KEY)||'';}catch{}
const known=new Set();
function base(url){try{const u=new URL(url,location.href);return u.origin+u.pathname;}catch{return '';}}
export function imageUrlWithRevision(url){if(url)known.add(base(url));return reviseImageUrl(currentImageUrl(url),revision);}
function isItemImage(url){if(!url)return false;try{const u=new URL(url,location.href);return known.has(base(url))||u.pathname.includes('/storage/v1/object/public/item-images/');}catch{return false;}}
function updateImages(){

 for(const el of document.querySelectorAll('img[src], [data-full]')){
  if(el.dataset.thumbnailUrl){const next=reviseImageUrl(currentImageUrl(el.dataset.thumbnailUrl),revision);if(next!==el.dataset.thumbnailUrl){el.dataset.thumbnailUrl=next;el.src=next;}}
  for(const attr of ['src','data-full']){const current=el.getAttribute(attr);if(!isItemImage(current))continue;const next=reviseImageUrl(currentImageUrl(current),revision);if(current!==next)el.setAttribute(attr,next);}
 }
}
let queued=false;
function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;updateImages();});}
function sync(){readReplacements();schedule();try{const stored=localStorage.getItem(IMAGE_REVISION_KEY)||'';if(stored!==revision){revision=stored;schedule();}}catch{}}
export function refreshSiteImages(){
 const next=Date.now().toString(36)+'-'+crypto.randomUUID();
 // Fail explicitly if persistence is blocked: new pages must see the same revision.
 localStorage.setItem(IMAGE_REVISION_KEY,next);revision=next;updateImages();return next;
}
if(typeof document!=='undefined'){
 window.addEventListener('storage',event=>{if(event.key===IMAGE_REVISION_KEY||event.key===REPLACEMENTS_KEY)sync();});
 window.addEventListener('focus',sync);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
 const observer=new MutationObserver(schedule);
 observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','data-full']});
 schedule();
}
