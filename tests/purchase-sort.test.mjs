import test from 'node:test';import assert from 'node:assert/strict';
import {recordPurchase,comparePurchases} from '../js/purchase-sort.js';
import {buildStock} from '../js/inventory-model.js';import {filterCatalog} from '../js/preorders-model.js';
test('purchase ordering uses latest purchase date, ignores later sales/adjustments and puts no-history materials last in either direction',()=>{
 const items=[{id:'a',is_active:true},{id:'b',is_active:true},{id:'c',is_active:true}];
 const moves=[{item_id:'a',type:'purchase',move_date:'2026-02-01'},{item_id:'a',type:'sale',move_date:'2026-09-20'},{item_id:'b',type:'purchase',move_date:'2026-01-01'},{item_id:'b',type:'purchase',move_date:'2026-08-01'},{item_id:'c',type:'adjustment',move_date:'2026-09-20'}];
 const stock=buildStock(items,moves,[]),catalog=items.map(i=>({...i}));for(const m of moves)recordPurchase(catalog.find(i=>i.id===m.item_id),m);
 for(const [sort,expected] of [['purchase_newest',['b','a','c']],['purchase_oldest',['a','b','c']]]){assert.deepEqual([...stock].sort((a,b)=>comparePurchases(a,b,sort)).map(i=>i.id),expected);assert.deepEqual(filterCatalog(catalog,{sort},{}).map(i=>i.id),expected);}
});
test('equal purchase dates use entry timestamp then stable identity',()=>{const a={id:'a'},b={id:'b'};recordPurchase(a,{type:'purchase',move_date:'2026-09-20',created_at:'2026-09-20T08:00:00Z'});recordPurchase(b,{type:'purchase',move_date:'2026-09-20',created_at:'2026-09-20T10:00:00Z'});assert.ok(comparePurchases(a,b)>0);recordPurchase(a,{type:'purchase',move_date:null});assert.equal(a.last_purchase_date,'2026-09-20');});
