import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// Exercise storage transaction boundaries independently of browser JPEG encoding.
const source=(await readFile(new URL('../js/item-image-store.js',import.meta.url),'utf8'))
 .replace(/^import .*image-cache.*$/m,'const recordImageReplacement=()=>{}, refreshSiteImages=()=>{};')
 .replace(/^import .*image-variants.*$/m,'const resizeImageBlob=async(b,n)=>({size:n}), thumbnailPath=p=>p+".thumb-200.jpg";');
const {saveImagePair,removeImagePair}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function fixture(mode=''){
 const state={path:'items/old.jpg',files:new Set(['items/old.jpg','items/old.jpg.thumb-200.jpg']),uploads:0};
 const bucket={upload:async p=>{if(mode==='upload'&&++state.uploads===2)return {error:Error('upload')};state.files.add(p);return {};},remove:async paths=>{paths.forEach(p=>state.files.delete(p));return {};}};
 const client={storage:{from:()=>bucket},from:()=>{let value;const q={update:v=>(value=v,q),eq:()=>q,is:()=>q,select:()=>q,single:()=>q,then:resolve=>{
  if(value){if(mode==='conflict')return resolve({data:[]});if(mode==='db'||mode==='unknown')return resolve({error:Error('write')});state.path=value.image_path;if(mode==='lost')return resolve({error:Error('network')});return resolve({data:[{id:'id'}]});}
  resolve(mode==='unknown'?{error:Error('offline')}:{data:{image_path:state.path}});
 }};return q;}};
 return {client,state};
}
test('replacement publishes both files, removes old pair, and deletion removes both versions',async()=>{
 const {client,state}=fixture();const {path}=await saveImagePair(client,'id',state.path,{});
 assert.equal(state.path,path);assert.deepEqual([...state.files].sort(),[path,path+'.thumb-200.jpg'].sort());
 await removeImagePair(client,path);assert.equal(state.files.size,0);
});
for(const mode of ['upload','db','conflict'])test(`${mode} failure retains previous full image and thumbnail`,async()=>{
 const {client,state}=fixture(mode);await assert.rejects(saveImagePair(client,'id',state.path,{}));
 assert.equal(state.path,'items/old.jpg');assert.deepEqual([...state.files].sort(),['items/old.jpg','items/old.jpg.thumb-200.jpg']);
});
test('lost response after commit never deletes the newly referenced pair',async()=>{
 const {client,state}=fixture('lost');const {path}=await saveImagePair(client,'id',state.path,{});
 assert.equal(state.path,path);assert.ok(state.files.has(path));assert.ok(state.files.has(path+'.thumb-200.jpg'));
});
test('unknown commit outcome retains files until status can be determined',async()=>{
 const {client,state}=fixture('unknown');await assert.rejects(saveImagePair(client,'id',state.path,{}));assert.equal(state.files.size,4);
});
