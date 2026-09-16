import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStorage } from '../js/auth-storage.js';
import { checkAccess } from '../js/auth-core.js';
function memory() { const values=new Map(); return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}; }
test('remembered sessions survive a new tab; temporary sessions do not leave persistent tokens',()=>{
  const local=memory(),tab=memory(),s=createSessionStorage(local,tab);
  local.setItem('token','legacy'); assert.equal(s.getItem('token'),'legacy');
  s.remember(false); s.setItem('token','temporary');
  assert.equal(local.getItem('token'),null); assert.equal(s.getItem('token'),'temporary');
  assert.equal(createSessionStorage(local,memory()).getItem('token'),null);
  s.remember(true); s.setItem('token','persistent');
  assert.equal(tab.getItem('token'),null);
  assert.equal(createSessionStorage(local,memory()).getItem('token'),'persistent');
  s.removeItem('token'); assert.equal(s.getItem('token'),null);
});
test('fast navigation still asks the database for current membership; forged local roles do not grant access',async()=>{
  let queries=0;
  const client={auth:{getSession:async()=>({data:{session:{user:{id:'u',user_metadata:{role:'admin'}}}}}),getUser:()=>{throw Error('unnecessary network request');}},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>{queries++;return {data:{role:'viewer',is_active:true}};}})})})};
  assert.equal((await checkAccess(client,{localSession:true})).member.role,'viewer');
  assert.equal(queries,1);
  client.from=()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role:'admin',is_active:false}})})})});
  assert.equal((await checkAccess(client,{localSession:true})).ok,false);
});

