import test from 'node:test';
import assert from 'node:assert/strict';
import {stockMatches,buildStock} from '../js/inventory-model.js';
import {canAccessPage} from '../js/permissions.js';
import {safeNext} from '../js/auth-core.js';
import {readFileSync} from 'node:fs';
test('inactive positive-stock filter accepts either unit balance and excludes active/empty materials',()=>{
 for(const [row,expected] of [[{is_active:false,balance_rolls:2},true],[{is_active:false,balance_main:1},true],[{is_active:true,balance_rolls:2},false],[{is_active:false,balance_rolls:0,balance_main:0},false],[{is_active:false,balance_rolls:-1,balance_main:-2},false]])assert.equal(stockMatches(row,'inactive_stock'),expected);
});
test('idle filters use the latest movement and require remaining stock',()=>{
 const row={balance_rolls:2,created_at:'2020-01-01',last_move_date:new Date(Date.now()-45*86400000).toISOString().slice(0,10)};
 assert.equal(stockMatches(row,'idle_30'),true);assert.equal(stockMatches(row,'idle_60'),false);
 assert.equal(stockMatches({...row,balance_rolls:0},'idle_30'),false);
 assert.equal(stockMatches({...row,last_move_date:'bad'},'idle_30'),false);
 const stock=buildStock([{id:'a'}],[{item_id:'a',type:'purchase',move_date:'2026-01-01',qty_rolls_in:3},{item_id:'a',type:'sale',move_date:'2026-10-01',qty_rolls_out:1}],[]);
 assert.equal(stock[0].last_move_date,'2026-10-01');
});
test('operation history accepts safe login redirect but only an active administrator can open it',()=>{
 for(const role of ['admin','assistant','viewer'])assert.equal(canAccessPage({role,is_active:true,permissions:{dashboard:'manage'}},'operation-history.html'),role==='admin');
 assert.equal(canAccessPage({role:'admin',is_active:false},'operation-history.html'),false);
 assert.equal(safeNext('operation-history.html','https://example.com/balance/login.html'),'https://example.com/balance/operation-history.html');
});
test('reconciliation draft keeps partial counts and is removed when all inputs are cleared',()=>{
 const source=readFileSync(new URL('../js/reconciliation.js',import.meta.url),'utf8');
 const helper=source.slice(source.indexOf('function persistDraft(){'),source.indexOf('function updateGroups(){'));
 const saved=new Map(),storage={setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 const controls={recon_date:{value:'2026-11-07'},draftNote:{textContent:''},discardReconDraft:{hidden:true}};
 const rows=[{item:{id:'a'},actualMain:0,actualRolls:null}];
 const persist=new Function('stateRows','localStorage','$',"const draftKey='draft:admin';"+helper+';return persistDraft;')(rows,storage,id=>controls[id]);
 persist();assert.deepEqual(JSON.parse(saved.get('draft:admin')).rows,[{id:'a',actualMain:0,actualRolls:null}]);
 rows[0].actualMain=null;persist();assert.equal(saved.size,0);assert.equal(controls.discardReconDraft.hidden,true);
});
