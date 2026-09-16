import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const tables = ['items','stock_moves','recon_sessions','recon_lines','customer_orders','customer_order_lines','import_batches','import_batch_lines'];
const admin = '11111111-1111-4111-8111-111111111111';
const viewer = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const migration = name => readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');

test('PostgreSQL policies isolate guests, unapproved users, viewers and administrators', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table storage.objects(id integer primary key, bucket_id text);
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to anon,authenticated;
      insert into storage.objects values (1,'item-images');
      ${tables.map(t=>`create table public.${t}(id integer primary key, payload text); insert into public.${t} values (1,'original'); grant all on public.${t} to anon,authenticated;`).join('\n')}
    `);
    await db.exec(migration('20260916113911_app_access_foundation.sql'));
    const enforce=migration('20260916113946_enforce_authenticated_inventory.sql');
    await assert.rejects(db.exec(enforce), /provision and verify/);
    await db.exec(`insert into auth.users(id,email_confirmed_at) values ('${admin}',now()),('${viewer}',now()),('${outsider}',now());
      insert into public.app_members(user_id,role,is_active) values ('${admin}','admin',true),('${viewer}','viewer',true);`);
    await db.exec(enforce);
    async function as(role, uid, sql) {
      await db.exec('begin');
      try {
        await db.exec(`set local role ${role};`);
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid||'']);
        return await db.query(sql);
      } finally { await db.exec('rollback'); }
    }
    for(const t of tables) {
      await assert.rejects(as('anon',null,`select * from public.${t}`), /permission denied/);
      assert.equal((await as('authenticated',outsider,`select * from public.${t}`)).rows.length,0);
      await assert.rejects(as('authenticated',outsider,`insert into public.${t} values(2,'attack')`), /row-level security/);
      assert.equal((await as('authenticated',viewer,`select * from public.${t}`)).rows.length,1);
      await assert.rejects(as('authenticated',viewer,`insert into public.${t} values(2,'attack')`), /row-level security/);
      assert.equal((await as('authenticated',viewer,`update public.${t} set payload='attack' returning id`)).rows.length,0);
      assert.equal((await as('authenticated',viewer,`delete from public.${t} returning id`)).rows.length,0);
      await assert.rejects(as('authenticated',admin,`truncate public.${t}`), /permission denied/);
      assert.equal((await as('authenticated',admin,`insert into public.${t} values(2,'allowed') returning id`)).rows.length,1);
      assert.equal((await as('authenticated',admin,`update public.${t} set payload='allowed' returning id`)).rows.length,1);
      assert.equal((await as('authenticated',admin,`delete from public.${t} returning id`)).rows.length,1);
      assert.deepEqual((await db.query(`select * from public.${t}`)).rows,[{id:1,payload:'original'}]);
    }
    assert.equal((await as('authenticated',viewer,'select * from public.app_members')).rows.length,1);
    await assert.rejects(as('authenticated',viewer,"update public.app_members set role='admin'"), /permission denied/);
    await assert.rejects(as('authenticated',outsider,`insert into public.app_members(user_id,role,is_active) values('${outsider}','admin',true)`), /permission denied/);
    for(const [role,uid] of [['anon',null],['authenticated',outsider],['authenticated',viewer]]) {
      await assert.rejects(as(role,uid,"insert into storage.objects values(2,'item-images')"), /row-level security/);
      assert.equal((await as(role,uid,'delete from storage.objects returning id')).rows.length,0);
    }
    assert.equal((await as('authenticated',admin,"insert into storage.objects values(2,'item-images') returning id")).rows.length,1);
    assert.equal((await as('authenticated',admin,"update storage.objects set bucket_id='item-images' returning id")).rows.length,1);
    await assert.rejects(as('authenticated',admin,"update storage.objects set bucket_id='other'"), /row-level security/);
    assert.equal((await as('authenticated',admin,'delete from storage.objects returning id')).rows.length,1);
    await db.exec(`update public.app_members set is_active=false where user_id='${admin}'`);
    assert.equal((await as('authenticated',admin,'select * from public.items')).rows.length,0);
    await assert.rejects(as('authenticated',admin,"insert into storage.objects values(2,'item-images')"), /row-level security/);
  } finally { await db.close(); }
});

