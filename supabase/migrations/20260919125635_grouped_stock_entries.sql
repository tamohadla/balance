-- Grouped stock entry ledger. Metadata only backfill: never change quantities.
create table public.stock_entry_groups (
 id uuid primary key default gen_random_uuid(),
 type text not null check(type in ('purchase','sale')),
 source text not null check(source in ('manual','excel','import','legacy')),
 created_at timestamptz not null default now(),
 created_by uuid references auth.users(id) on delete set null,
 created_by_name text,
 note text,
 source_file_name text,
 import_batch_id uuid unique references public.import_batches(id) on delete set null,
 transaction_key text unique,
 fingerprint text,
 revision bigint not null default 0,
 updated_at timestamptz,
 updated_by_name text,
 deleted_at timestamptz
);
alter table public.stock_moves add column entry_group_id uuid references public.stock_entry_groups(id);
create index stock_moves_entry_group_idx on public.stock_moves(entry_group_id);
create index stock_entry_groups_type_created_idx on public.stock_entry_groups(type,created_at desc);
-- Keep known import grouping; ungrouped historical rows remain individual records.
insert into public.stock_entry_groups(id,type,source,created_at,source_file_name,import_batch_id,transaction_key)
select b.id,b.batch_type,'legacy',coalesce(min(m.created_at),b.created_at),b.source_file_name,b.id,'import:'||b.id::text
from public.import_batches b join public.stock_moves m on m.import_batch_id=b.id
where m.type in ('purchase','sale') group by b.id;
update public.stock_moves set entry_group_id=import_batch_id where type in ('purchase','sale') and import_batch_id is not null;
insert into public.stock_entry_groups(id,type,source,created_at)
select id,type,'legacy',coalesce(created_at,now()) from public.stock_moves where type in ('purchase','sale') and entry_group_id is null;
update public.stock_moves set entry_group_id=id where type in ('purchase','sale') and entry_group_id is null;

alter table public.stock_entry_groups enable row level security;
grant select,insert,update,delete on public.stock_entry_groups to authenticated;
create policy stock_groups_read on public.stock_entry_groups for select to authenticated using
(exists(select 1 from public.app_members where user_id=(select auth.uid()) and is_active and role in ('admin','viewer')));
create policy stock_groups_admin on public.stock_entry_groups for all to authenticated using
(exists(select 1 from public.app_members where user_id=(select auth.uid()) and is_active and role='admin')) with check
(exists(select 1 from public.app_members where user_id=(select auth.uid()) and is_active and role='admin'));

create function public.stamp_stock_entry_group() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.created_at:=now();new.created_by:=auth.uid();
  select coalesce(nullif(display_name,''),'مستخدم مخوّل') into new.created_by_name from public.app_members where user_id=auth.uid();
 else
  new.created_at:=old.created_at;new.created_by:=old.created_by;new.created_by_name:=old.created_by_name;
  new.type:=old.type;new.source:=old.source;new.fingerprint:=old.fingerprint;
  new.updated_at:=now();
  select coalesce(nullif(display_name,''),'مستخدم مخوّل') into new.updated_by_name from public.app_members where user_id=auth.uid();
 end if;return new;
end $$;
create trigger stamp_stock_entry_group before insert or update on public.stock_entry_groups for each row execute function public.stamp_stock_entry_group();

-- Also group inserts from older clients and the advanced import workflow.
create function public.assign_stock_entry_group() returns trigger language plpgsql security invoker set search_path='' as $$
declare g public.stock_entry_groups%rowtype;k text;
begin
 if tg_op='UPDATE' and (new.entry_group_id is distinct from old.entry_group_id or new.type is distinct from old.type) then raise exception 'GROUP_MEMBERSHIP_IMMUTABLE';end if;
 if new.type not in ('purchase','sale') then return new;end if;
 if new.entry_group_id is null then
  k:=case when new.import_batch_id is not null then 'import:'||new.import_batch_id::text else pg_catalog.pg_current_xact_id()::text||':'||new.type end;
  insert into public.stock_entry_groups(type,source,transaction_key,import_batch_id,source_file_name)
   values(new.type,case when new.import_batch_id is null then 'manual' else 'import' end,k,new.import_batch_id,
   (select source_file_name from public.import_batches where id=new.import_batch_id))
   on conflict(transaction_key) do update set transaction_key=excluded.transaction_key returning id into new.entry_group_id;
 end if;
 select * into g from public.stock_entry_groups where id=new.entry_group_id for update;
 if not found or g.type<>new.type or g.deleted_at is not null then raise exception 'INVALID_ENTRY_GROUP';end if;
 return new;
end $$;
create trigger assign_stock_entry_group before insert or update on public.stock_moves for each row execute function public.assign_stock_entry_group();
create function public.touch_stock_entry_group() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update public.stock_entry_groups set revision=revision+1 where id=case when tg_op='DELETE' then old.entry_group_id else new.entry_group_id end;
 if tg_op='DELETE' and old.import_batch_line_id is not null then
  update public.import_batch_lines set is_posted=false,posted_at=null,is_included=false,match_status='excluded' where id=old.import_batch_line_id;
 end if;
 return null;
end $$;
create trigger touch_stock_entry_group after insert or update or delete on public.stock_moves for each row execute function public.touch_stock_entry_group();

create function public.create_stock_entry(p_id uuid,p_type text,p_source text,p_note text,p_file text,p_lines jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare g public.stock_entry_groups%rowtype;fp text;
begin
 if not exists(select 1 from public.app_members where user_id=auth.uid() and is_active and role='admin') then raise exception 'ENTRY_ACCESS_DENIED';end if;
 if p_id is null or p_type not in ('purchase','sale') or p_source not in ('manual','excel') or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'INVALID_ENTRY';end if;
 if jsonb_array_length(p_lines) not between 1 and 10000 or coalesce(length(p_note),0)>2000 or coalesce(length(p_file),0)>500 then raise exception 'INVALID_ENTRY';end if;
 fp:=md5(jsonb_build_array(p_type,p_source,p_note,p_file,p_lines)::text);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,83291));
 select * into g from public.stock_entry_groups where id=p_id;
 if found then
  if g.created_by is distinct from auth.uid() or g.fingerprint is distinct from fp or g.deleted_at is not null then raise exception 'ENTRY_REQUEST_CONFLICT';end if;
  return g.id;
 end if;
 if exists(select 1 from jsonb_to_recordset(p_lines) as l(item_id uuid,move_date date,qty_main numeric,qty_rolls numeric,note text)
  where l.item_id is null or l.move_date is null or l.qty_main is null or not(l.qty_main>0 and l.qty_main<1000000000)
  or l.qty_rolls is null or not(l.qty_rolls>=0 and l.qty_rolls<=1000000 and trunc(l.qty_rolls)=l.qty_rolls)
  or coalesce(length(l.note),0)>2000 or not exists(select 1 from public.items i where i.id=l.item_id and i.is_active)) then raise exception 'INVALID_ENTRY_LINES';end if;
 insert into public.stock_entry_groups(id,type,source,note,source_file_name,fingerprint) values(p_id,p_type,p_source,p_note,p_file,fp);
 insert into public.stock_moves(entry_group_id,type,item_id,move_date,note,qty_main_in,qty_main_out,qty_rolls_in,qty_rolls_out)
 select p_id,p_type,l.item_id,l.move_date,l.note,case when p_type='purchase' then l.qty_main else 0 end,case when p_type='sale' then l.qty_main else 0 end,
 case when p_type='purchase' then l.qty_rolls::integer else 0 end,case when p_type='sale' then l.qty_rolls::integer else 0 end
 from jsonb_to_recordset(p_lines) as l(item_id uuid,move_date date,qty_main numeric,qty_rolls numeric,note text);
 return p_id;
end $$;

create function public.change_stock_entry(p_group uuid,p_revision bigint,p_action text,p_line uuid default null,p_values jsonb default null)
returns void language plpgsql security invoker set search_path='' as $$
declare g public.stock_entry_groups%rowtype;q numeric;r numeric;d date;
begin
 if not exists(select 1 from public.app_members where user_id=auth.uid() and is_active and role='admin') then raise exception 'ENTRY_ACCESS_DENIED';end if;
 select * into g from public.stock_entry_groups where id=p_group for update;
 if not found or g.deleted_at is not null then raise exception 'ENTRY_NOT_FOUND';end if;
 if g.revision<>p_revision then raise exception 'ENTRY_CHANGED';end if;
 if p_action='delete_group' then
  delete from public.stock_moves where entry_group_id=p_group;
  -- Cancel all remaining unposted lines too, preventing accidental repost.
  update public.import_batch_lines set is_included=false,is_posted=false,posted_at=null,match_status='excluded' where batch_id=g.import_batch_id;
  update public.import_batches set status='cancelled',approved_lines_count=0,pending_lines_count=0,excluded_lines=total_lines where id=g.import_batch_id;
  update public.stock_entry_groups set deleted_at=now(),revision=revision+1 where id=p_group;
 elsif p_action in ('delete_line','edit_line') then
  if not exists(select 1 from public.stock_moves where id=p_line and entry_group_id=p_group) then raise exception 'ENTRY_NOT_FOUND';end if;
  if p_action='delete_line' then delete from public.stock_moves where id=p_line and entry_group_id=p_group;
  else
   q:=(p_values->>'qty_main')::numeric;r:=(p_values->>'qty_rolls')::numeric;d:=(p_values->>'move_date')::date;
   if q is null or not(q>0 and q<1000000000) or r is null or not(r>=0 and r<=1000000 and trunc(r)=r) or d is null or coalesce(length(p_values->>'note'),0)>2000 then raise exception 'INVALID_ENTRY_LINES';end if;
   if p_values->>'item_id' is not null and not exists(select 1 from public.items i where i.id=(p_values->>'item_id')::uuid and (i.is_active or i.id=(select item_id from public.stock_moves where id=p_line))) then raise exception 'INVALID_ENTRY_LINES';end if;
   update public.stock_moves set item_id=coalesce((p_values->>'item_id')::uuid,item_id),move_date=d,note=p_values->>'note',qty_main_in=case when g.type='purchase' then q else 0 end,qty_main_out=case when g.type='sale' then q else 0 end,
    qty_rolls_in=case when g.type='purchase' then r::integer else 0 end,qty_rolls_out=case when g.type='sale' then r::integer else 0 end where id=p_line and entry_group_id=p_group;
  end if;
  update public.import_batches b set approved_lines_count=(select count(*) from public.import_batch_lines where batch_id=b.id and is_posted),pending_lines_count=(select count(*) from public.import_batch_lines where batch_id=b.id and is_included and not is_posted),excluded_lines=(select count(*) from public.import_batch_lines where batch_id=b.id and not is_included) where b.id=g.import_batch_id;
  if not exists(select 1 from public.stock_moves where entry_group_id=p_group) then update public.stock_entry_groups set deleted_at=now() where id=p_group;end if;
 else raise exception 'INVALID_ENTRY_ACTION';end if;
end $$;

create function public.post_stock_import(p_batch uuid) returns void language plpgsql security invoker set search_path='' as $$
declare b public.import_batches%rowtype;l public.import_batch_lines%rowtype;
begin
 if not exists(select 1 from public.app_members where user_id=auth.uid() and is_active and role='admin') then raise exception 'ENTRY_ACCESS_DENIED';end if;
 select * into b from public.import_batches where id=p_batch for update;
 if not found or b.status='cancelled' then raise exception 'ENTRY_NOT_FOUND';end if;
 for l in select * from public.import_batch_lines where batch_id=p_batch and is_included and not is_posted and
 ((match_status in ('exact_match','manual_match') and matched_item_id is not null) or (match_status='suggested_match' and suggested_approved and suggested_item_id is not null) or (match_status='duplicate_warning' and duplicate_approved and coalesce(matched_item_id,suggested_item_id) is not null)) order by row_index for update loop
  if l.raw_qty_primary is null or l.raw_qty_primary<=0 or l.raw_rolls is null or l.raw_rolls<0 or l.raw_date is null then raise exception 'INVALID_ENTRY_LINES';end if;
  insert into public.stock_moves(type,item_id,move_date,note,qty_main_in,qty_main_out,qty_rolls_in,qty_rolls_out,import_batch_id,import_batch_line_id)
  values(b.batch_type,coalesce(l.matched_item_id,l.suggested_item_id),l.raw_date,l.raw_notes,case when b.batch_type='purchase' then l.raw_qty_primary else 0 end,case when b.batch_type='sale' then l.raw_qty_primary else 0 end,
  case when b.batch_type='purchase' then l.raw_rolls else 0 end,case when b.batch_type='sale' then l.raw_rolls else 0 end,p_batch,l.id)
  on conflict(import_batch_line_id) where import_batch_line_id is not null do nothing;
  update public.import_batch_lines set is_posted=true,posted_at=now() where id=l.id;
 end loop;
 update public.import_batches set approved_lines_count=(select count(*) from public.import_batch_lines where batch_id=p_batch and is_posted),pending_lines_count=(select count(*) from public.import_batch_lines where batch_id=p_batch and is_included and not is_posted) where id=p_batch;
 update public.import_batches set status=case when approved_lines_count=0 then 'draft' when pending_lines_count>0 then 'partially_approved' else 'approved' end,approved_at=case when pending_lines_count=0 and approved_lines_count>0 then now() else null end where id=p_batch;
end $$;
revoke all on function public.create_stock_entry(uuid,text,text,text,text,jsonb),public.change_stock_entry(uuid,bigint,text,uuid,jsonb),public.post_stock_import(uuid) from public,anon;
grant execute on function public.create_stock_entry(uuid,text,text,text,text,jsonb),public.change_stock_entry(uuid,bigint,text,uuid,jsonb),public.post_stock_import(uuid) to authenticated;
