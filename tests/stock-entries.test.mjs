import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const admin = "11111111-1111-4111-8111-111111111111",
  viewer = "22222222-2222-4222-8222-222222222222",
  item = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  item2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
test("grouped ledger preserves historical quantities, stamps trusted actors, atomic/idempotent saves, revision checks and whole group removal", async () => {
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
    async function call(sql, args = [], actor = admin, role = "authenticated") {
      await db.exec("begin");
      try {
        await db.exec(`set local role ${role}`);
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          actor || "",
        ]);
        const r = await db.query(sql, args);
        await db.exec("commit");
        return r;
      } catch (e) {
        await db.exec("rollback");
        throw e;
      }
    }
    const rpc = "select create_stock_entry($1,$2,$3,$4,$5,$6::jsonb) id",
      id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const lines = [
      {
        item_id: item,
        move_date: "2026-09-18",
        qty_main: 12.5,
        qty_rolls: 2,
        note: "x",
      },
      { item_id: item2, move_date: "2026-09-18", qty_main: 7, qty_rolls: 1 },
    ];
    const args = [
      id,
      "purchase",
      "manual",
      "فاتورة",
      null,
      JSON.stringify(lines),
    ];
    await call(rpc, args);
    await call(rpc, args);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from stock_moves where entry_group_id=$1",
          [id],
        )
      ).rows[0].n,
      2,
    );
    let g = (
      await db.query("select * from stock_entry_groups where id=$1", [id])
    ).rows[0];
    assert.equal(g.created_by, admin);
    assert.equal(g.created_by_name, "مدير الاختبار");
    assert.equal(g.revision, 2);
    await assert.rejects(
      call(rpc, [...args.slice(0, 3), "changed", ...args.slice(4)]),
      /ENTRY_REQUEST_CONFLICT/,
    );
    await assert.rejects(call(rpc, args, viewer), /ENTRY_ACCESS_DENIED/);
    await assert.rejects(call(rpc, args, null, "anon"), /permission denied/);
    await call(
      "update stock_entry_groups set created_by=$1,created_by_name='forged',created_at='2000-01-01' where id=$2",
      [viewer, id],
    );
    assert.equal(
      (
        await db.query(
          "select created_by_name from stock_entry_groups where id=$1",
          [id],
        )
      ).rows[0].created_by_name,
      "مدير الاختبار",
    );
    // A late failure rolls back the group and all prior lines.
    await db.exec(
      `create function reject_test_line() returns trigger language plpgsql as $$begin if new.qty_main_in=77 then raise exception 'TEST_LATE_FAILURE';end if;return new;end$$;create trigger reject_test_line before insert on stock_moves for each row execute function reject_test_line();`,
    );
    const fail = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await assert.rejects(
      call(rpc, [
        fail,
        "purchase",
        "excel",
        null,
        "test.xlsx",
        JSON.stringify([lines[0], { ...lines[1], qty_main: 77 }]),
      ]),
      /TEST_LATE_FAILURE/,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from stock_entry_groups where id=$1",
          [fail],
        )
      ).rows[0].n,
      0,
    );
    await call(rpc, [
      fail,
      "sale",
      "excel",
      null,
      "test.xlsx",
      JSON.stringify(lines),
    ]);
    const move = (
      await db.query(
        "select id from stock_moves where entry_group_id=$1 limit 1",
        [id],
      )
    ).rows[0].id;
    const edit = "select change_stock_entry($1,$2,$3,$4,$5::jsonb)";
    await call(edit, [
      id,
      2,
      "edit_line",
      move,
      JSON.stringify({
        qty_main: 20,
        qty_rolls: 3,
        move_date: "2026-09-17",
        note: "edited",
      }),
    ]);
    await assert.rejects(
      call(edit, [id, 2, "delete_group", null, null]),
      /ENTRY_CHANGED/,
    );
    await assert.rejects(
      call(edit, [id, 3, "delete_group", null, null], viewer),
      /ENTRY_ACCESS_DENIED/,
    );
    await call(edit, [id, 3, "delete_line", move, null]);
    await call(edit, [id, 4, "delete_group", null, null]);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from stock_moves where entry_group_id=$1",
          [id],
        )
      ).rows[0].n,
      0,
    );
    assert.ok(
      (
        await db.query(
          "select deleted_at from stock_entry_groups where id=$1",
          [id],
        )
      ).rows[0].deleted_at,
    );
    await assert.rejects(call(rpc, args), /ENTRY_REQUEST_CONFLICT/);
    // Older clients still receive one group per transaction, with authenticated actor.
    await call(
      `insert into stock_moves(type,item_id,qty_main_in) values('purchase','${item}',5),('purchase','${item2}',6)`,
    );
    assert.equal(
      (
        await db.query(
          "select count(distinct entry_group_id)::int n from stock_moves where qty_main_in in (5,6)",
        )
      ).rows[0].n,
      1,
    );
    // Advanced imports post atomically, then share the same group across retries.
    const batch = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await call(
      "insert into import_batches(id,batch_no,batch_type,source_file_name,total_lines)values($1,'T1','purchase','file.xlsx',2)",
      [batch],
    );
    await call(
      `insert into import_batch_lines(batch_id,row_index,matched_item_id,raw_qty_primary,raw_rolls,raw_date,match_status) values($1,1,$2,8,1,'2026-09-19','exact_match'),($1,2,$2,77,2,'2026-09-19','exact_match')`,
      [batch, item],
    );
    await assert.rejects(
      call("select post_stock_import($1)", [batch]),
      /TEST_LATE_FAILURE/,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from stock_moves where import_batch_id=$1",
          [batch],
        )
      ).rows[0].n,
      0,
    );
    await call(
      "update import_batch_lines set raw_qty_primary=9 where batch_id=$1 and row_index=2",
      [batch],
    );
    await call("select post_stock_import($1)", [batch]);
    await call("select post_stock_import($1)", [batch]);
    const imported = (
      await db.query(
        "select * from stock_entry_groups where import_batch_id=$1",
        [batch],
      )
    ).rows[0];
    assert.equal(imported.created_by, admin);
    assert.equal(imported.revision, 2);
    await call(edit, [
      imported.id,
      imported.revision,
      "delete_group",
      null,
      null,
    ]);
    assert.equal(
      (await db.query("select status from import_batches where id=$1", [batch]))
        .rows[0].status,
      "cancelled",
    );
    await assert.rejects(
      call("select post_stock_import($1)", [batch]),
      /ENTRY_NOT_FOUND/,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from stock_moves where import_batch_id=$1",
          [batch],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
