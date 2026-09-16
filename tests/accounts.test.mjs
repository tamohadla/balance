import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { makeHandler } from '../supabase/functions/manage-accounts/handler.js';

test('account changes are service-only, atomic, audited and protect the last administrator', async () => {
  const db = new PGlite();
  const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      grant usage on schema public,auth to authenticated,service_role;
      insert into auth.users values('${a}'),('${b}');`);
    for(const name of ['20260916113911_app_access_foundation.sql','20260916122937_account_management.sql'])
      await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
    await db.exec(`insert into public.app_members(user_id,role,is_active) values('${a}','admin',true),('${b}','viewer',true);`);
    const call=(actor,target,role,active)=>`select public.admin_save_member('${actor}','${target}','Name','${role}',${active})`;
    async function as(role, sql) {
      await db.exec('begin');
      try { await db.exec(`set local role ${role}`); const result=await db.query(sql); await db.exec('commit'); return result; }
      catch(e) { await db.exec('rollback'); throw e; }
    }
    await assert.rejects(as('authenticated',call(b,b,'admin',true)), /permission denied/);
    await assert.rejects(as('anon',call(a,a,'admin',true)), /permission denied/);
    await assert.rejects(as('authenticated','select * from public.account_events'), /permission denied/);
    await assert.rejects(as('service_role',call(b,b,'admin',true)), /ADMIN_REQUIRED/);
    await assert.rejects(as('service_role',call(a,a,'viewer',true)), /LAST_ADMIN/);
    await assert.rejects(as('service_role',call(a,a,'admin',false)), /LAST_ADMIN/);
    assert.equal((await db.query('select count(*)::int as n from public.account_events')).rows[0].n,0);
    await as('service_role',call(a,b,'admin',true));
    await as('service_role',call(a,a,'viewer',true));
    await assert.rejects(as('service_role',call(a,b,'viewer',true)), /ADMIN_REQUIRED/);
    await assert.rejects(as('service_role',call(b,b,'viewer',true)), /LAST_ADMIN/);
    await as('service_role',call(b,a,'viewer',false));
    const events=(await db.query('select action,details from public.account_events order by id')).rows;
    assert.equal(events.length,3); assert.equal(events[2].details.after.is_active,false);
    assert.equal((await db.query(`select role from public.app_members where user_id='${b}'`)).rows[0].role,'admin');
  } finally { await db.close(); }
});

const id='11111111-1111-4111-8111-111111111111';
function mock(role='admin', active=true) {
  const calls=[];
  const admin={ auth:{ getUser:async()=>({ data:{user:{id}},error:null }),admin:{} },
    from: table=>({ select:()=>({ eq:()=>({ maybeSingle:async()=>({ data:{role,is_active:active},error:null }) }) }) }),
    rpc:async(name,body)=>{calls.push([name,body]);return {data:null,error:null};} };
  return {admin,calls};
}
const request=body=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer test',origin:'http://127.0.0.1:49165'},body:JSON.stringify(body)});
test('edge denies missing/anonymous/disabled/non-admin identities before administrative calls',async()=>{
  for(const [role,active] of [['viewer',true],['admin',false]]) {
    const {admin,calls}=mock(role,active);
    assert.equal((await makeHandler(admin,{})(request({action:'save',id,name:'N',role:'admin',active:true}))).status,403);
    assert.equal(calls.length,0);
  }
  const {admin}=mock();
  assert.equal((await makeHandler(admin,{})(new Request('https://example.test',{method:'POST'}))).status,401);
  admin.auth.getUser=async()=>({data:{user:{id,is_anonymous:true}}});
  assert.equal((await makeHandler(admin,{})(request({action:'list'}))).status,401);
});
test('edge derives actor from verified identity and rejects malformed roles',async()=>{
  const {admin,calls}=mock(); const handler=makeHandler(admin,{});
  assert.equal((await handler(request({action:'save',id,name:'N',role:'owner',active:true}))).status,400);
  assert.equal((await handler(request({action:'save',id,name:'N',role:'viewer',active:true,actor:'forged'}))).status,200);
  assert.equal(calls[0][1].actor,id);
  admin.rpc=async()=>({error:{message:'LAST_ADMIN'}});
  assert.equal((await handler(request({action:'save',id,name:'N',role:'viewer',active:true}))).status,409);
});
test('email actions derive recipients and fixed redirects on the server',async()=>{
  const {admin}=mock(); let sent;
  admin.auth.admin.getUserById=async()=>({data:{user:{email:'member@example.test'}}});
  admin.from=table=>table==='account_events'?{insert:async()=>({error:null})}:{select:()=>({eq:()=>({maybeSingle:async()=>({data:{role:'admin',is_active:true}})})})};
  const publicClient={auth:{resetPasswordForEmail:async(email,options)=>{sent={email,options};return {error:null};}}};
  const result=await makeHandler(admin,publicClient)(request({action:'reset',id,email:'attacker@example.test',redirectTo:'https://evil.test'}));
  assert.equal(result.status,200); assert.equal(sent.email,'member@example.test');
  assert.equal(sent.options.redirectTo,'http://127.0.0.1:49165/login.html?mode=password');
});
