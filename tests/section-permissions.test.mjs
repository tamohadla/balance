import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const admin = "11111111-1111-4111-8111-111111111111",
  viewer = "22222222-2222-4222-8222-222222222222",
  item = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  item2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
test("section permissions enforce read/manage, locked sections, viewer scope and service-only account edits", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;grant usage on schema public,auth,storage to anon,authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
 create table storage.objects(id uuid primary key,bucket_id text);alter table storage.objects enable row level security;grant all on storage.objects to anon,authenticated;
 create table items(id uuid primary key,is_active boolean);
 create table stock_moves(id uuid primary key default gen_random_uuid(),item_id uuid references items(id) on delete cascade,move_date date,type text,qty_main_in numeric default 0,qty_main_out numeric default 0,qty_rolls_in integer default 0,qty_rolls_out integer default 0,note text,created_at timestamptz default now());
 ${["recon_sessions", "recon_lines", "customer_orders", "customer_order_lines"].map((t) => `create table ${t}(id uuid primary key);`).join("")}
 insert into auth.users(id,email_confirmed_at)values('${admin}',now()),('${viewer}',now());insert into items values('${item}',true),('${item2}',true);
 insert into stock_moves(type,item_id,move_date,qty_main_in,qty_rolls_in) values('purchase','${item}','2026-09-01',30,3),('adjustment','${item}','2026-09-01',2,1);`);
    await db.exec(read("sql/2026-04-12-import-batches.sql"));
    await db.exec(
      read("supabase/migrations/20260916113911_app_access_foundation.sql"),
    );
    await db.exec(
      `insert into app_members(user_id,role,is_active,display_name) values('${admin}','admin',true,'مدير الاختبار'),('${viewer}','viewer',true,'موظف');`,
    );
    await db.exec(
      read(
        "supabase/migrations/20260916124956_enforce_authenticated_inventory.sql",
      ),
    );
    const baseline = (
      await db.query(
        "select type,sum(qty_main_in)::text q,count(*)::int n from stock_moves group by type order by type",
      )
    ).rows;
    await db.exec(
      read("supabase/migrations/20260919125635_grouped_stock_entries.sql"),
    );
    assert.deepEqual(
      (
        await db.query(
          "select type,sum(qty_main_in)::text q,count(*)::int n from stock_moves group by type order by type",
        )
      ).rows,
      baseline,
    );
    assert.equal(
      (
        await db.query(
          "select created_by from stock_entry_groups where source='legacy'",
        )
      ).rows[0].created_by,
      null,
    );
    assert.equal(
      (
        await db.query(
          "select entry_group_id from stock_moves where type='adjustment'",
        )
      ).rows[0].entry_group_id,
      null,
    );

    await db.exec(`alter table customer_orders add column customer_name text,add column customer_phone text,add column note text,add column status text default 'draft',add column created_at timestamptz default now();
      alter table customer_order_lines alter column id set default gen_random_uuid(); alter table customer_order_lines add column order_id uuid references customer_orders(id),add column item_id uuid references items(id),add column qty_rolls integer;`);
    await db.exec(read('supabase/migrations/20260916122937_account_management.sql'));
    await db.exec(read('supabase/migrations/20260919114801_employee_order_checkout.sql'));
    await db.exec(read('supabase/migrations/20260922120845_section_permissions.sql'));
    const assistant='33333333-3333-4333-8333-333333333333';
    await db.exec(`insert into auth.users(id,email_confirmed_at)values('${assistant}',now());
      insert into app_members(user_id,role,is_active,permissions)values('${assistant}','assistant',true,'{"purchases":"read"}');`);
    async function as(actor,sql,args=[]){await db.exec('begin');try{await db.exec('set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);return await db.query(sql,args);}finally{await db.exec('rollback');}}
    assert.equal((await as(assistant,"select public.section_access('purchases') yes")).rows[0].yes,true);
    assert.equal((await as(assistant,"select public.section_access('purchases',true) yes")).rows[0].yes,false);
    assert.equal((await as(assistant,"select * from stock_moves where type='purchase'")).rows.length,1);
    assert.equal((await as(assistant,"select * from stock_moves where type='adjustment'")).rows.length,0);
    await assert.rejects(as(assistant,`insert into stock_moves(type,item_id,move_date,qty_main_in)values('purchase','${item}',current_date,5)`),/row-level security/);
    await db.exec(`update app_members set permissions='{"purchases":"manage"}' where user_id='${assistant}'`);
    assert.equal((await as(assistant,`insert into stock_moves(type,item_id,move_date,qty_main_in)values('purchase','${item}',current_date,5) returning id`)).rows.length,1);
    await assert.rejects(as(assistant,`insert into stock_moves(type,item_id,move_date,qty_main_out)values('sale','${item}',current_date,5)`),/row-level security/);
    assert.equal((await as(assistant,`update items set is_active=false returning id`)).rows.length,0);
    await assert.rejects(as(assistant,`update app_members set role='admin'`),/permission denied/);
    await assert.rejects(as(assistant,`select public.admin_save_member('${admin}','${assistant}','X','assistant',true,'{"items":"manage"}')`),/permission denied/);
    assert.equal((await as(viewer,"select public.section_access('inventory') yes, public.section_access('purchases') no,public.order_create_access() create_order")).rows[0].create_order,true);
    assert.equal((await as(viewer,"select public.section_access('purchases') allowed")).rows[0].allowed,false);
    assert.equal((await as(viewer,'select * from stock_moves')).rows.length,2);
    const checkout="select public.create_employee_order('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Client','123','', $1::jsonb)";
    assert.equal((await as(viewer,checkout,[JSON.stringify([{item_id:item,qty_rolls:2}])])).rows.length,1);
    await assert.rejects(as(assistant,checkout,[JSON.stringify([{item_id:item,qty_rolls:2}])]),/ORDER_ACCESS_DENIED/);
    await db.exec(`update app_members set permissions='{"orders":"read"}' where user_id='${assistant}'`);
    assert.equal((await as(assistant,'select public.order_create_access() allowed')).rows[0].allowed,false);
    await db.exec(`update app_members set permissions='{"orders":"manage"}' where user_id='${assistant}'`);
    assert.equal((await as(assistant,'select public.order_create_access() allowed')).rows[0].allowed,true);
    await assert.rejects(as(assistant,`insert into customer_orders(id,status)values(gen_random_uuid(),'executed')`),/row-level security/);
    await db.exec(`update app_members set is_active=false where user_id='${assistant}'`);
    assert.equal((await as(assistant,'select * from items')).rows.length,0);
    await assert.rejects(db.exec(`update app_members set permissions='{"users":"manage"}' where user_id='${assistant}'`),/check constraint/);
    await assert.rejects(db.exec(`select public.admin_save_member('${admin}','${admin}','X','assistant',true,'{}')`),/LAST_ADMIN/);
  }finally{await db.close();}
});
