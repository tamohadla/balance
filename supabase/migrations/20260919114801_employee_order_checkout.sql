-- Employees can create their own draft orders. Existing admin-only UPDATE,
-- DELETE, sales and stock policies are unchanged. RPC runs under caller RLS.
alter table public.customer_orders add column created_by uuid default auth.uid() references auth.users(id) on delete set null;
alter table public.customer_orders add column checkout_fingerprint text;
create index customer_orders_created_by_idx on public.customer_orders(created_by);

create policy employees_create_drafts on public.customer_orders for insert to authenticated
with check (
  created_by = (select auth.uid()) and status = 'draft'
  and exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('admin','viewer'))
);
create policy employees_create_draft_lines on public.customer_order_lines for insert to authenticated
with check (
  qty_rolls > 0
  and exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.is_active and m.role in ('admin','viewer'))
  and exists(select 1 from public.customer_orders o where o.id=order_id and o.created_by=(select auth.uid()) and o.status='draft')
  and exists(select 1 from public.items i where i.id=item_id and i.is_active)
);

create function public.create_employee_order(p_order_id uuid, p_customer_name text, p_customer_phone text, p_note text, p_lines jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  normalized_lines jsonb;
  fingerprint text;
  existing public.customer_orders%rowtype;
  result public.customer_orders%rowtype;
  line_count integer;
begin
  if actor is null or not exists(select 1 from public.app_members m where m.user_id=actor and m.is_active and m.role in ('admin','viewer')) then
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
