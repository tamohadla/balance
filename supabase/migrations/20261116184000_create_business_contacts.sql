begin;

create table public.business_contacts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('customers', 'suppliers')),
  name text not null check (char_length(btrim(name)) between 1 and 150),
  phone text not null default '' check (char_length(phone) <= 40),
  address text not null default '' check (char_length(address) <= 250),
  notes text not null default '' check (char_length(notes) <= 1000)
);

create index business_contacts_kind_name_id_idx on public.business_contacts (kind, name, id);

alter table public.business_contacts enable row level security;
revoke all on public.business_contacts from public, anon, authenticated;
grant select, insert (kind, name, phone, address, notes), update (name, phone, address, notes)
  on public.business_contacts to authenticated;

create policy business_contacts_admin_select on public.business_contacts
  for select to authenticated
  using ((select public.section_access(null, true)));

create policy business_contacts_admin_insert on public.business_contacts
  for insert to authenticated
  with check ((select public.section_access(null, true)));

create policy business_contacts_admin_update on public.business_contacts
  for update to authenticated
  using ((select public.section_access(null, true)))
  with check ((select public.section_access(null, true)));

commit;
