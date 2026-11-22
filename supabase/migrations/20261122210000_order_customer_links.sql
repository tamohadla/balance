begin;

alter table public.customer_orders
  add column customer_id uuid references public.business_contacts(id),
  add column customer_request_id uuid references public.customer_requests(id);
create index customer_orders_customer_request_idx on public.customer_orders(customer_request_id)
  where customer_request_id is not null;

alter policy customer_requests_read on public.customer_requests using (
  (select public.section_access(null, true)) or
  (requested_by = (select auth.uid()) and
    ((select public.section_access('sales', true)) or (select public.order_create_access())))
);
alter policy customer_requests_submit on public.customer_requests with check (
  requested_by = (select auth.uid()) and
  ((select public.section_access('sales', true)) or (select public.order_create_access()))
);

create function public.search_order_customers(p_search text)
returns table(id uuid, name text, brand_name text, code text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.brand_name, upper(left(c.id::text, 8))
  from public.business_contacts c
  where auth.uid() is not null and public.order_create_access()
    and c.kind = 'customers' and length(trim(p_search)) between 1 and 150
    and (strpos(lower(c.name), lower(trim(p_search))) > 0
      or strpos(lower(c.brand_name), lower(trim(p_search))) > 0
      or strpos(lower(left(c.id::text, 8)), lower(trim(p_search))) > 0)
  order by c.name, c.id limit 20
$$;
revoke all on function public.search_order_customers(text) from public, anon;
grant execute on function public.search_order_customers(text) to authenticated;

create function public.validate_order_customer_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  request public.customer_requests%rowtype;
begin
  if tg_op = 'UPDATE' then
    if old.customer_request_id is not null and old.customer_id is null
       and new.customer_id is null and new.status <> 'draft' then
      raise exception 'CUSTOMER_APPROVAL_REQUIRED';
    end if;
    if new.customer_id is not distinct from old.customer_id
       and new.customer_request_id is not distinct from old.customer_request_id then
      return new;
    end if;
    if not public.section_access(null, true) then
      raise exception 'CUSTOMER_LINK_CHANGE_DENIED';
    end if;
  end if;
  if new.customer_request_id is not null then
    select * into request from public.customer_requests
    where id = new.customer_request_id for share;
    if not found or request.requested_by is distinct from new.created_by
       or (tg_op = 'INSERT' and request.requested_by is distinct from auth.uid()) then
      raise exception 'INVALID_CUSTOMER_REQUEST';
    end if;
    if request.status = 'returned' then raise exception 'INVALID_CUSTOMER_REQUEST'; end if;
    new.customer_id := request.customer_id;
    new.customer_name := request.name;
    if new.customer_id is null and new.status <> 'draft' then
      raise exception 'CUSTOMER_APPROVAL_REQUIRED';
    end if;
  end if;
  if new.customer_id is not null then
    select c.name into new.customer_name from public.business_contacts c
    where c.id = new.customer_id and c.kind = 'customers';
    if not found then raise exception 'INVALID_CUSTOMER'; end if;
  end if;
  if new.customer_id is not null or new.customer_request_id is not null then
    new.customer_phone := '';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_order_customer_link() from public, anon, authenticated;
create trigger validate_order_customer_link before insert or update of customer_id, customer_request_id, status
on public.customer_orders for each row execute function public.validate_order_customer_link();

create function public.resolve_order_customer_request() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.customer_orders set customer_id = new.customer_id
  where customer_request_id = new.id and customer_id is null and status = 'draft';
  return new;
end;
$$;
revoke all on function public.resolve_order_customer_request() from public, anon, authenticated;
create trigger resolve_order_customer_request after update of customer_id on public.customer_requests
for each row when (old.customer_id is null and new.customer_id is not null)
execute function public.resolve_order_customer_request();

create or replace function public.create_customer_draft_order(p_order_id uuid, p_customer_id uuid, p_request_id uuid, p_note text, p_lines jsonb)
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
  if p_order_id is null or (p_customer_id is null) = (p_request_id is null) or coalesce(length(p_note),0)>2000 then
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
  fingerprint := md5(jsonb_build_object('customer',p_customer_id,'request',p_request_id,'note',nullif(trim(p_note),''),'lines',normalized_lines)::text);
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
  insert into public.customer_orders(id,customer_id,customer_request_id,customer_name,customer_phone,note,status,created_by,checkout_fingerprint)
    values(p_order_id,p_customer_id,p_request_id,'','',nullif(trim(p_note),''),'draft',actor,fingerprint)
    returning * into result;
  insert into public.customer_order_lines(order_id,item_id,qty_rolls)
    select result.id,l.item_id,l.qty_rolls from jsonb_to_recordset(normalized_lines) as l(item_id uuid,qty_rolls integer);
  return jsonb_build_object('id',result.id,'created_at',result.created_at);
end $$;
revoke all on function public.create_customer_draft_order(uuid,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.create_customer_draft_order(uuid,uuid,uuid,text,jsonb) to authenticated;

commit;
