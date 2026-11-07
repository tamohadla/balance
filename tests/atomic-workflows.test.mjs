import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildStock} from '../js/inventory-model.js';
import {transferOrder} from '../js/orders-model.js';
const source=(await readFile(new URL('../js/reconciliation-service.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'const supabase={};\n');
const {createReconciliationClient}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
const lines=[{item_id:'a',book_main:10,book_rolls:2,actual_main:5,actual_rolls:1}];
test('pending sales retain stock reservation and can be resumed',async()=>{
const stock=buildStock([{id:'a',unit_type:'kg'}],[{item_id:'a',qty_rolls_in:10}],[{item_id:'a',qty_rolls:4,customer_orders:{status:'pending_sale'}}]);
assert.equal(stock[0].balance_after_orders,6);
let navigated=false;await transferOrder({order:{id:'o',status:'pending_sale'},lines:[{item_id:'a',qty_rolls:4}],storage:storage(),updateStatus:async()=>{},navigate:()=>navigated=true});assert.ok(navigated);
});
test('uncertain reconciliation survives reload and retries with the same identity',async()=>{
const local=storage();let calls=0;const ids=[];
const rpc=async request=>{ids.push(request.p_id);if(!calls++)throw Error('network');return {data:request.p_id};};
const client=createReconciliationClient({userId:'u',scope:'single',storage:local,rpc,uuid:()=> 'stable'});
await assert.rejects(client.save('2026-11-07',lines));assert.equal(client.pending().p_id,'stable');
const reloaded=createReconciliationClient({userId:'u',scope:'single',storage:local,rpc});
await reloaded.recover();assert.deepEqual(ids,['stable','stable']);assert.equal(reloaded.pending(),null);
});
test('changed balances clear failed attempt; ambiguous attempts cannot be silently replaced',async()=>{
const local=storage();const client=createReconciliationClient({userId:'u',scope:'monthly',storage:local,rpc:async()=>{throw Error('network');},uuid:()=> 'id'});
await assert.rejects(client.save('2026-11-07',lines));
await assert.rejects(client.save('2026-11-08',lines),/محاولة/);
const retry=createReconciliationClient({userId:'u',scope:'monthly',storage:local,rpc:async()=>({error:{message:'RECON_STOCK_CHANGED'}})});
await assert.rejects(retry.recover());assert.equal(retry.pending(),null);
});
test('storage failure prevents submission; accounts and reconciliation types are isolated',async()=>{
let calls=0;
const bad=createReconciliationClient({userId:'u',scope:'single',storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}},rpc:async()=>{calls++;}});
await assert.rejects(bad.save('2026-11-07',lines));assert.equal(calls,0);
const local=storage(),one=createReconciliationClient({userId:'a',scope:'single',storage:local,rpc:async()=>{throw Error('network');},uuid:()=> 'id'});
await assert.rejects(one.save('2026-11-07',lines));
for(const [userId,scope] of [['b','single'],['a','monthly']])assert.equal(createReconciliationClient({userId,scope,storage:local}).pending(),null);
});

const entrySource=await readFile(new URL('../js/moves-entry.js',import.meta.url),'utf8');
const draftHelpers=entrySource.slice(entrySource.indexOf('function draftSnapshot(){'),entrySource.indexOf('function summary() {'));
test('draft captures incomplete entries without coercing empty quantities to zero',()=>{
 const local=storage(),controls={move_date:{value:'2026-11-07'},groupNote:{value:'استلام'},draftStatus:{textContent:''}};
 const values={'.itemSearch':{value:'بحث لم يكتمل'},'.qtyMain':{value:''},'.qtyRolls':{value:'0'},'.lineNote':{value:'ملاحظة'}};
 controls.rows={children:[{dataset:{},querySelector:k=>values[k]}]};
 const create=new Function('$','localStorage',`const draftKey='draft:u:sale';let draftReady=true,busy=false,pending=null,admin=true,prefill=null; ${draftHelpers};return {persistDraft,draftSnapshot};`);
 const draft=create(id=>controls[id],local);draft.persistDraft();
 const saved=JSON.parse(local.getItem('draft:u:sale'));assert.equal(saved.lines[0].qty_main,'');assert.equal(saved.lines[0].qty_rolls,'0');assert.equal(saved.lines[0].search,'بحث لم يكتمل');assert.equal(saved.note,'استلام');
 controls.groupNote.value='';for(const value of Object.values(values))value.value='';
 draft.persistDraft();assert.equal(local.getItem('draft:u:sale'),null);
});
test('draft storage failure reports warning and does not discard entered fields',()=>{
 const controls={move_date:{value:'2026-11-07'},groupNote:{value:'draft'},rows:{children:[]},draftStatus:{textContent:''}};
 const create=new Function('$','localStorage',`const draftKey='draft';let draftReady=true,busy=false,pending=null,admin=true,prefill=null; ${draftHelpers};return persistDraft;`);
 create(id=>controls[id],{setItem(){throw Error('quota');}})();
 assert.match(controls.draftStatus.textContent,/تعذر/);assert.equal(controls.groupNote.value,'draft');
});
