import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {quantity,cleanCart,filterCatalog,cartTotals} from '../js/preorders-model.js';
const uid='22222222-2222-4222-8222-222222222222',admin='11111111-1111-4111-8111-111111111111',other='33333333-3333-4333-8333-333333333333';
const item='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',item2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',order='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const migration=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
test('cart accepts Arabic integers but rejects negative, fractional, huge or malformed values',()=>{
assert.equal(quantity('١٢'),12);for(const n of ['-1','1.5','1e3','100001',''])assert.equal(quantity(n),null);
assert.deepEqual(cleanCart({[item]:'١٢',bad:10,[item2]:0}),{[item]:12});assert.deepEqual(cartTotals({[item]:12,[item2]:8}),{items:2,rolls:20});
const rows=[{id:item,is_active:true,item_name:'أبيض قطن',balance_rolls:20,pending_rolls:4},{id:item2,is_active:false,item_name:'قطن',balance_rolls:3}];
assert.equal(filterCatalog(rows,{search:'ابيض قطن',available:true},{}).length,1);assert.equal(filterCatalog(rows,{selected:true},{}).length,0);
});
test('checkout is atomic, idempotent, caller-owned and preserves administrator-only writes',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;grant usage on schema public,auth,storage to anon,authenticated,service_role;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.objects(id uuid primary key,bucket_id text);alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;
 create table public.items(id uuid primary key,is_active boolean);
 create table public.customer_orders(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),customer_name text,customer_phone text,status text,note text);
 create table public.customer_order_lines(id uuid primary key default gen_random_uuid(),order_id uuid references public.customer_orders(id) on delete cascade,item_id uuid references public.items(id),qty_rolls integer check(qty_rolls>=0));
 ${['stock_moves','recon_sessions','recon_lines','import_batches','import_batch_lines'].map(t=>`create table public.${t}(id uuid primary key);`).join('')}
 insert into auth.users(id,email_confirmed_at) values('${admin}',now()),('${uid}',now()),('${other}',now());insert into public.items values('${item}',true),('${item2}',true);`);
 await db.exec(migration('20260916113911_app_access_foundation.sql'));
 await db.exec(`insert into public.app_members(user_id,role,is_active)values('${admin}','admin',true),('${uid}','viewer',true),('${other}','viewer',true);`);
 await db.exec(migration('20260916124956_enforce_authenticated_inventory.sql'));
 await db.exec(migration('20260919114801_employee_order_checkout.sql'));
 async function call(sql,args=[],actor=uid,role='authenticated'){
  await db.exec('begin');try{await db.exec(`set local role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor||'']);const r=await db.query(sql,args);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}
 }
 const rpc='select public.create_employee_order($1,$2,$3,$4,$5::jsonb) as result';
 const args=[order,'عميل تجريبي','01000000000',null,JSON.stringify([{item_id:item,qty_rolls:5}])];
 const created=(await call(rpc,args)).rows[0].result;assert.equal(created.id,order);
 assert.deepEqual((await call(rpc,args)).rows[0].result,created);
 assert.equal((await db.query('select count(*)::int as n from public.customer_order_lines')).rows[0].n,1);
 await assert.rejects(call(rpc,[...args.slice(0,4),JSON.stringify([{item_id:item,qty_rolls:6}])]),/ORDER_REQUEST_CONFLICT/);
 await assert.rejects(call(rpc,args,other),/ORDER_REQUEST_CONFLICT/);
 assert.equal((await call("update public.customer_orders set status='executed' returning id")).rows.length,0);
 assert.equal((await call('delete from public.customer_orders returning id')).rows.length,0);
 await assert.rejects(call(`insert into public.stock_moves(id) values(gen_random_uuid())`),/row-level security/);
 await assert.rejects(call(`insert into public.customer_orders(customer_name,status,created_by) values('x','executed','${uid}')`),/row-level security/);
 await assert.rejects(call(rpc,args,null,'anon'),/permission denied/);
 // Force a late line-insert failure: header and earlier lines must roll back.
 await db.exec(`create function public.reject_line() returns trigger language plpgsql as $$begin if new.qty_rolls=77 then raise exception 'TEST_LINE_FAILURE';end if;return new;end$$;create trigger reject_line before insert on public.customer_order_lines for each row execute function public.reject_line();`);
 const failID='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 await assert.rejects(call(rpc,[failID,'عميل','010',null,JSON.stringify([{item_id:item,qty_rolls:1},{item_id:item2,qty_rolls:77}])]),/TEST_LINE_FAILURE/);
 assert.equal((await db.query('select count(*)::int as n from public.customer_orders where id=$1',[failID])).rows[0].n,0);
 await db.exec(`update public.app_members set is_active=false where user_id='${uid}'`);
 await assert.rejects(call(rpc,args),/ORDER_ACCESS_DENIED/);
 }finally{await db.close();}
});
