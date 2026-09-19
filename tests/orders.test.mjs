import test from 'node:test';
import assert from 'node:assert/strict';
import {filterOrders,totalRolls,transferOrder,SALES_PREFILL_KEY} from '../js/orders-model.js';
const orders=[
{id:'one',customer_name:'أحمد',customer_phone:'010 123-456',status:'draft',created_at:'2026-09-18T10:00:00Z',customer_order_lines:[{qty_rolls:'12'}]},
{id:'two',customer_name:'ياسر',status:'confirmed',created_at:'2026-09-12T10:00:00Z',customer_order_lines:[{qty_rolls:30}]},
{id:'three',customer_name:'محمود',status:'executed',created_at:'2026-08-01T10:00:00Z',customer_order_lines:[]}
];
test('Arabic search, Arabic digits, formatted phones, and punctuation do not match all orders',()=>{
assert.deepEqual(filterOrders(orders,{search:'احمد'}).map(o=>o.id),['one']);
assert.deepEqual(filterOrders(orders,{search:'٠١٠١٢٣٤٥٦'}).map(o=>o.id),['one']);
assert.equal(filterOrders(orders,{search:'+++'}).length,0);
});
test('filters intersect, seven day boundary, numeric totals and sorting',()=>{
assert.equal(totalRolls([{qty_rolls:'12'},{qty_rolls:3}]),15);
assert.deepEqual(filterOrders(orders,{period:'7',status:'confirmed'},new Date(2026,8,18,20)).map(o=>o.id),['two']);
assert.deepEqual(filterOrders(orders,{sort:'rolls'}).map(o=>o.id),['two','one','three']);
assert.equal(orders[0].id,'one');
});
function storage(initial=null){const map=new Map(initial?[[SALES_PREFILL_KEY,initial]]:[]);return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};}
const lines=[{item_id:'item',qty_rolls:4}];
test('storage failure prevents status mutation and navigation',async()=>{
let writes=0;await assert.rejects(transferOrder({order:orders[0],lines,storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}},updateStatus:()=>writes++,navigate:()=>writes++}),/quota/);assert.equal(writes,0);
});
test('confirmed orders transfer only after durable payload and confirmed update',async()=>{
const s=storage(),events=[];await transferOrder({order:orders[1],lines,storage:s,updateStatus:async()=>{assert.equal(JSON.parse(s.getItem(SALES_PREFILL_KEY)).order_id,'two');events.push('update');},navigate:url=>events.push(url)});assert.deepEqual(events,['update','./sales.html?prefill=order']);
});
test('failed update never navigates and preserves recovery payload',async()=>{
const s=storage();let moved=false;await assert.rejects(transferOrder({order:orders[0],lines,storage:s,updateStatus:async()=>{throw Error('network');},navigate:()=>moved=true}),/network/);assert.equal(moved,false);assert.ok(s.getItem(SALES_PREFILL_KEY));
});
test('empty, already executed, or different pending orders cannot transfer',async()=>{
for(const [order,rows,s] of [[orders[0],[],storage()],[orders[2],lines,storage()],[orders[0],lines,storage(JSON.stringify({order_id:'another'}))]]){
let writes=0;await assert.rejects(transferOrder({order,lines:rows,storage:s,updateStatus:()=>writes++,navigate:()=>writes++}));assert.equal(writes,0);
}
});
