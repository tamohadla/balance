-- Account control only. No inventory rows are changed.
create table public.account_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  target_id uuid not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.account_events enable row level security;
revoke all on public.account_events from public, anon, authenticated;
grant select, insert on public.account_events to service_role;
grant usage, select on sequence public.account_events_id_seq to service_role;
create index account_events_created_idx on public.account_events(created_at desc, id desc);

create function public.admin_save_member(actor uuid, target uuid, member_name text, member_role text, active boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare previous jsonb;
begin
  -- Serializes membership edits, including concurrent demotions of two admins.
  perform pg_catalog.pg_advisory_xact_lock(829411703);
  if not exists(select 1 from public.app_members where user_id=actor and role='admin' and is_active) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if member_role is null or member_role not in ('admin','viewer') or active is null
      or member_name is null or length(member_name)>100 then raise exception 'INVALID_MEMBER'; end if;
  select to_jsonb(m) into previous from public.app_members m where user_id=target;
  if previous->>'role'='admin' and (previous->>'is_active')::boolean
      and (member_role<>'admin' or not active)
      and not exists(select 1 from public.app_members where user_id<>target and role='admin' and is_active) then
    raise exception 'LAST_ADMIN';
  end if;
  insert into public.app_members(user_id,display_name,role,is_active)
    values(target,trim(member_name),member_role,active)
    on conflict(user_id) do update set display_name=excluded.display_name,role=excluded.role,is_active=excluded.is_active;
  insert into public.account_events(actor_id,target_id,action,details)
    values(actor,target,'member_saved',jsonb_build_object('before',previous,'after',jsonb_build_object('display_name',trim(member_name),'role',member_role,'is_active',active)));
end $$;
revoke all on function public.admin_save_member(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.admin_save_member(uuid,uuid,text,text,boolean) to service_role;

create function public.inventory_access_enforced() returns boolean
language sql stable security invoker set search_path = '' as $$
  select count(*)=8 and bool_and(c.relrowsecurity and not pg_catalog.has_table_privilege('anon',c.oid,'SELECT'))
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('items','stock_moves','recon_sessions','recon_lines','customer_orders','customer_order_lines','import_batches','import_batch_lines');
$$;
revoke all on function public.inventory_access_enforced() from public,anon,authenticated;
grant execute on function public.inventory_access_enforced() to service_role;
