begin;

create table public.customer_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(btrim(name)) between 1 and 150),
  brand_name text not null default '' check (char_length(brand_name) <= 150),
  phone text not null default '' check (char_length(phone) <= 40),
  address text not null default '' check (char_length(address) <= 250),
  status text not null default 'pending' check (status in ('pending', 'approved', 'linked', 'returned')),
  review_note text not null default '',
  reviewed_by uuid,
  reviewed_at timestamptz,
  customer_id uuid references public.business_contacts(id)
);

create index customer_requests_author_idx on public.customer_requests (requested_by, created_at desc);
create index customer_requests_review_idx on public.customer_requests (status, created_at desc);

alter table public.customer_requests enable row level security;
revoke all on public.customer_requests from public, anon, authenticated;
grant select, insert (name, brand_name, phone, address),
  update (status, reviewed_by, reviewed_at, review_note, customer_id)
  on public.customer_requests to authenticated;

create policy customer_requests_read on public.customer_requests for select to authenticated
using (
  (select public.section_access(null, true))
  or (requested_by = (select auth.uid()) and (select public.section_access('sales', true)))
);
create policy customer_requests_submit on public.customer_requests for insert to authenticated
with check (requested_by = (select auth.uid()) and (select public.section_access('sales', true)));
create policy customer_requests_review on public.customer_requests for update to authenticated
using ((select public.section_access(null, true)))
with check ((select public.section_access(null, true)));

create function public.review_customer_request(
  request_id uuid, decision text, linked_id uuid, details jsonb, note text
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  approved_id uuid;
begin
  if not public.section_access(null, true) then
    raise exception 'Review requires an active administrator';
  end if;
  perform 1 from public.customer_requests where id = request_id and status = 'pending' for update;
  if not found then raise exception 'Request is no longer pending'; end if;

  case decision
    when 'approved' then
      insert into public.business_contacts (kind, name, brand_name, phone, address, customer_category)
      values ('customers', btrim(details->>'name'), coalesce(details->>'brand_name', ''),
        coalesce(details->>'phone', ''), coalesce(details->>'address', ''),
        coalesce(details->>'customer_category', 'regular'))
      returning id into approved_id;
    when 'linked' then
      select id into approved_id from public.business_contacts where id = linked_id and kind = 'customers';
      if not found then raise exception 'Choose an existing customer'; end if;
    when 'returned' then
      if nullif(btrim(note), '') is null then raise exception 'Provide a reason'; end if;
    else raise exception 'Unknown decision';
  end case;

  update public.customer_requests
  set status = decision, reviewed_by = auth.uid(), reviewed_at = now(),
      customer_id = approved_id, review_note = left(coalesce(note, ''), 500)
  where id = request_id;
  return approved_id;
end;
$$;
revoke all on function public.review_customer_request(uuid,text,uuid,jsonb,text) from public, anon;
grant execute on function public.review_customer_request(uuid,text,uuid,jsonb,text) to authenticated;
commit;
