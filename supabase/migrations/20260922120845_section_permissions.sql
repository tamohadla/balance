-- Per-section authorization; existing business rows and balances are unchanged.
alter table public.app_members drop constraint app_members_role_check;
alter table public.app_members add constraint app_members_role_check check(role in ('admin','viewer','assistant'));
alter table public.app_members add column permissions jsonb not null default '{}'::jsonb;
create function public.valid_section_permissions(p jsonb) returns boolean language sql immutable security invoker set search_path='' as $$
 select case when jsonb_typeof(p)='object' then not exists(select 1 from jsonb_each_text(p) e where e.key not in ('dashboard','items','inventory','purchases','sales','orders','adjustments') or e.value not in ('read','manage') or e.value is null) else false end
$$;
alter table public.app_members add constraint valid_permissions check(public.valid_section_permissions(permissions));
create function public.section_access(section text, manage boolean default false) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.is_active and (
 m.role='admin' or (m.role='viewer' and not manage and section in ('inventory','orders')) or
 (m.role='assistant' and (m.permissions->>section='manage' or (not manage and m.permissions->>section='read')))))
$$;
create function public.order_create_access() returns boolean language sql stable security invoker set search_path='' as $$
 select public.section_access('orders',true) or exists(select 1 from public.app_members where user_id=(select auth.uid()) and is_active and role='viewer')
$$;
create function public.stock_section(kind text) returns text language sql immutable security invoker set search_path='' as $$select case kind when 'purchase' then 'purchases' when 'sale' then 'sales' else 'adjustments' end$$;
create function public.stock_read_access(kind text) returns boolean language sql stable security invoker set search_path='' as $$
 select public.section_access('inventory') or public.section_access('orders') or public.section_access('adjustments') or public.section_access(public.stock_section(kind))
$$;
create function public.stock_write_access(kind text) returns boolean language sql stable security invoker set search_path='' as $$
 select public.section_access(public.stock_section(kind),true) or (kind not in ('purchase','sale') and public.section_access('inventory',true))
$$;
create function public.admin_save_member(actor uuid, target uuid, member_name text, member_role text, active boolean, section_permissions jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare previous jsonb;
begin
  -- Serializes membership edits, including concurrent demotions of two admins.
  perform pg_catalog.pg_advisory_xact_lock(829411703);
  if not exists(select 1 from public.app_members where user_id=actor and role='admin' and is_active) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if member_role is null or member_role not in ('admin','viewer','assistant') or active is null
      or member_name is null or length(member_name)>100 then raise exception 'INVALID_MEMBER'; end if;
  if not public.valid_section_permissions(section_permissions) then raise exception 'INVALID_MEMBER'; end if;
  if member_role<>'assistant' then section_permissions:='{}'::jsonb; end if;
  select to_jsonb(m) into previous from public.app_members m where user_id=target;
  if previous->>'role'='admin' and (previous->>'is_active')::boolean
      and (member_role<>'admin' or not active)
      and not exists(select 1 from public.app_members where user_id<>target and role='admin' and is_active) then
    raise exception 'LAST_ADMIN';
  end if;
  insert into public.app_members(user_id,display_name,role,is_active,permissions)
    values(target,trim(member_name),member_role,active,section_permissions)
    on conflict(user_id) do update set display_name=excluded.display_name,role=excluded.role,is_active=excluded.is_active,permissions=excluded.permissions;
  insert into public.account_events(actor_id,target_id,action,details)
    values(actor,target,'member_saved',jsonb_build_object('before',previous,'after',jsonb_build_object('display_name',trim(member_name),'role',member_role,'is_active',active,'permissions',section_permissions)));
end $$;
revoke all on function public.admin_save_member(uuid,uuid,text,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.admin_save_member(uuid,uuid,text,text,boolean,jsonb) to service_role;

create or replace function public.admin_save_member(actor uuid,target uuid,member_name text,member_role text,active boolean) returns void language sql security invoker set search_path='' as $$
 select public.admin_save_member(actor,target,member_name,member_role,active,'{}'::jsonb)
$$;
do $$declare p record;begin for p in select tablename,policyname from pg_policies where schemaname='public' and tablename in ('items','stock_moves','stock_entry_groups','recon_sessions','recon_lines','customer_orders','customer_order_lines','import_batches','import_batch_lines') loop execute format('drop policy %I on public.%I',p.policyname,p.tablename);end loop;end$$;
create policy section_read on public.items for select to authenticated using (exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.is_active and (m.role in ('admin','viewer') or (m.role='assistant' and m.permissions<>'{}'::jsonb))));
create policy section_insert on public.items for insert to authenticated with check (public.section_access('items',true));
create policy section_update on public.items for update to authenticated using (public.section_access('items',true)) with check (public.section_access('items',true));
create policy section_delete on public.items for delete to authenticated using (public.section_access('items',true)) ;
create policy section_read on public.stock_moves for select to authenticated using (public.stock_read_access(type));
create policy section_insert on public.stock_moves for insert to authenticated with check (public.stock_write_access(type));
create policy section_update on public.stock_moves for update to authenticated using (public.stock_write_access(type)) with check (public.stock_write_access(type));
create policy section_delete on public.stock_moves for delete to authenticated using (public.stock_write_access(type)) ;
create policy section_read on public.stock_entry_groups for select to authenticated using (public.stock_read_access(type));
create policy section_insert on public.stock_entry_groups for insert to authenticated with check (public.stock_write_access(type));
create policy section_update on public.stock_entry_groups for update to authenticated using (public.stock_write_access(type)) with check (public.stock_write_access(type));
create policy section_delete on public.stock_entry_groups for delete to authenticated using (public.stock_write_access(type)) ;
create policy section_read on public.recon_sessions for select to authenticated using (public.section_access('adjustments') or public.section_access('inventory'));
create policy section_insert on public.recon_sessions for insert to authenticated with check (public.section_access('adjustments',true) or public.section_access('inventory',true));
create policy section_update on public.recon_sessions for update to authenticated using (public.section_access('adjustments',true) or public.section_access('inventory',true)) with check (public.section_access('adjustments',true) or public.section_access('inventory',true));
create policy section_delete on public.recon_sessions for delete to authenticated using (public.section_access('adjustments',true) or public.section_access('inventory',true)) ;
create policy section_read on public.recon_lines for select to authenticated using (public.section_access('adjustments') or public.section_access('inventory'));
create policy section_insert on public.recon_lines for insert to authenticated with check (public.section_access('adjustments',true) or public.section_access('inventory',true));
create policy section_update on public.recon_lines for update to authenticated using (public.section_access('adjustments',true) or public.section_access('inventory',true)) with check (public.section_access('adjustments',true) or public.section_access('inventory',true));
create policy section_delete on public.recon_lines for delete to authenticated using (public.section_access('adjustments',true) or public.section_access('inventory',true)) ;
create policy section_read on public.customer_orders for select to authenticated using (public.section_access('orders') or public.section_access('inventory') or public.section_access('sales'));
create policy section_insert on public.customer_orders for insert to authenticated with check (public.section_access('orders',true) and (status<>'executed' or public.section_access('sales',true)));
create policy section_update on public.customer_orders for update to authenticated using (public.section_access('orders',true)) with check (public.section_access('orders',true) and (status<>'executed' or public.section_access('sales',true)));
create policy section_delete on public.customer_orders for delete to authenticated using (public.section_access('orders',true)) ;
create policy section_read on public.customer_order_lines for select to authenticated using (public.section_access('orders') or public.section_access('inventory') or public.section_access('sales'));
create policy section_insert on public.customer_order_lines for insert to authenticated with check (public.section_access('orders',true));
create policy section_update on public.customer_order_lines for update to authenticated using (public.section_access('orders',true)) with check (public.section_access('orders',true));
create policy section_delete on public.customer_order_lines for delete to authenticated using (public.section_access('orders',true)) ;
create policy section_read on public.import_batches for select to authenticated using (public.section_access(public.stock_section(batch_type)));
create policy section_insert on public.import_batches for insert to authenticated with check (public.section_access(public.stock_section(batch_type),true));
create policy section_update on public.import_batches for update to authenticated using (public.section_access(public.stock_section(batch_type),true)) with check (public.section_access(public.stock_section(batch_type),true));
create policy section_delete on public.import_batches for delete to authenticated using (public.section_access(public.stock_section(batch_type),true)) ;
create policy section_read on public.import_batch_lines for select to authenticated using (exists(select 1 from public.import_batches b where b.id=batch_id and public.section_access(public.stock_section(b.batch_type))));
create policy section_insert on public.import_batch_lines for insert to authenticated with check (exists(select 1 from public.import_batches b where b.id=batch_id and public.section_access(public.stock_section(b.batch_type),true)));
create policy section_update on public.import_batch_lines for update to authenticated using (exists(select 1 from public.import_batches b where b.id=batch_id and public.section_access(public.stock_section(b.batch_type),true))) with check (exists(select 1 from public.import_batches b where b.id=batch_id and public.section_access(public.stock_section(b.batch_type),true)));
create policy section_delete on public.import_batch_lines for delete to authenticated using (exists(select 1 from public.import_batches b where b.id=batch_id and public.section_access(public.stock_section(b.batch_type),true))) ;
create policy employees_create_drafts on public.customer_orders for insert to authenticated with check(created_by=(select auth.uid()) and status='draft' and public.order_create_access());
create policy employees_create_draft_lines on public.customer_order_lines for insert to authenticated with check(qty_rolls>0 and public.order_create_access() and exists(select 1 from public.customer_orders o where o.id=order_id and o.created_by=(select auth.uid()) and o.status='draft') and exists(select 1 from public.items i where i.id=item_id and i.is_active));
create or replace function public.create_employee_order(p_order_id uuid, p_customer_name text, p_customer_phone text, p_note text, p_lines jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  normalized_lines jsonb;
  fingerprint text;
  existing public.customer_orders%rowtype;
  result public.customer_orders%rowtype;
  line_count integer;
begin
  if actor is null or not public.order_create_access() then
    raise exception 'ORDER_ACCESS_DENIED';
  end if;
  if p_order_id is null or coalesce(length(trim(p_customer_name)),0) not between 1 and 160
    or coalesce(length(trim(p_customer_phone)),0) not between 1 and 40 or coalesce(length(p_note),0)>2000 then
    raise exception 'INVALID_CUSTOMER';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'INVALID_LINES'; end if;
  line_count := jsonb_array_length(p_lines);
  if line_count not between 1 and 500 then raise exception 'INVALID_LINES'; end if;
  if exists(select 1 from jsonb_to_recordset(p_lines) as l(item_id uuid, qty_rolls integer)
    where l.item_id is null or l.qty_rolls is null or l.qty_rolls not between 1 and 100000)
    or (select count(distinct l.item_id) from jsonb_to_recordset(p_lines) as l(item_id uuid, qty_rolls integer)) <> line_count then
    raise exception 'INVALID_LINES';
  end if;
  select jsonb_agg(jsonb_build_object('item_id',l.item_id,'qty_rolls',l.qty_rolls) order by l.item_id)
    into normalized_lines from jsonb_to_recordset(p_lines) as l(item_id uuid, qty_rolls integer);
  fingerprint := md5(jsonb_build_object('name',trim(p_customer_name),'phone',trim(p_customer_phone),'note',nullif(trim(p_note),''),'lines',normalized_lines)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_order_id::text, 79231));
  select * into existing from public.customer_orders where id=p_order_id;
  if found then
    if existing.created_by is distinct from actor or existing.checkout_fingerprint is distinct from fingerprint then
      raise exception 'ORDER_REQUEST_CONFLICT';
    end if;
    return jsonb_build_object('id',existing.id,'created_at',existing.created_at);
  end if;
  if (select count(*) from public.items i join jsonb_to_recordset(normalized_lines) as l(item_id uuid,qty_rolls integer) on i.id=l.item_id where i.is_active) <> line_count then
    raise exception 'ITEM_UNAVAILABLE';
  end if;
  insert into public.customer_orders(id,customer_name,customer_phone,note,status,created_by,checkout_fingerprint)
    values(p_order_id,trim(p_customer_name),trim(p_customer_phone),nullif(trim(p_note),''),'draft',actor,fingerprint)
    returning * into result;
  insert into public.customer_order_lines(order_id,item_id,qty_rolls)
    select result.id,l.item_id,l.qty_rolls from jsonb_to_recordset(normalized_lines) as l(item_id uuid,qty_rolls integer);
  return jsonb_build_object('id',result.id,'created_at',result.created_at);
end $$;
revoke all on function public.create_employee_order(uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.create_employee_order(uuid,text,text,text,jsonb) to authenticated;
create or replace function public.create_stock_entry(p_id uuid,p_type text,p_source text,p_note text,p_file text,p_lines jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare g public.stock_entry_groups%rowtype;fp text;
begin
 if not public.stock_write_access(p_type) then raise exception 'ENTRY_ACCESS_DENIED';end if;
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

create or replace function public.change_stock_entry(p_group uuid,p_revision bigint,p_action text,p_line uuid default null,p_values jsonb default null)
returns void language plpgsql security invoker set search_path='' as $$
declare g public.stock_entry_groups%rowtype;q numeric;r numeric;d date;
begin
 if not coalesce((select public.stock_write_access(type) from public.stock_entry_groups where id=p_group),false) then raise exception 'ENTRY_ACCESS_DENIED';end if;
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

create or replace function public.post_stock_import(p_batch uuid) returns void language plpgsql security invoker set search_path='' as $$
declare b public.import_batches%rowtype;l public.import_batch_lines%rowtype;
begin
 if not coalesce((select public.stock_write_access(batch_type) from public.import_batches where id=p_batch),false) then raise exception 'ENTRY_ACCESS_DENIED';end if;
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
drop policy inventory_images_read on storage.objects;
drop policy inventory_images_insert on storage.objects;
drop policy inventory_images_update on storage.objects;
drop policy inventory_images_delete on storage.objects;
create policy inventory_images_read on storage.objects for select to authenticated using(bucket_id='item-images' and exists(select 1 from public.app_members m where user_id=(select auth.uid()) and is_active));
create policy inventory_images_insert on storage.objects for insert to authenticated with check(bucket_id='item-images' and public.section_access('items',true));
create policy inventory_images_update on storage.objects for update to authenticated using(bucket_id='item-images' and public.section_access('items',true)) with check(bucket_id='item-images' and public.section_access('items',true));
create policy inventory_images_delete on storage.objects for delete to authenticated using(bucket_id='item-images' and public.section_access('items',true));
revoke all on function public.valid_section_permissions(jsonb) from public,anon;
grant execute on function public.valid_section_permissions(jsonb) to authenticated,service_role;
revoke all on function public.section_access(text,boolean) from public,anon;
grant execute on function public.section_access(text,boolean) to authenticated,service_role;
revoke all on function public.order_create_access() from public,anon;
grant execute on function public.order_create_access() to authenticated,service_role;
revoke all on function public.stock_section(text) from public,anon;
grant execute on function public.stock_section(text) to authenticated,service_role;
revoke all on function public.stock_read_access(text) from public,anon;
grant execute on function public.stock_read_access(text) to authenticated,service_role;
revoke all on function public.stock_write_access(text) from public,anon;
grant execute on function public.stock_write_access(text) to authenticated,service_role;
