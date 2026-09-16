-- Phase 1A: additive access registry. No existing business rows are changed.
create table public.app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.app_members enable row level security;
revoke all on public.app_members from public, anon, authenticated;
grant select on public.app_members to authenticated;
grant select, insert, update, delete on public.app_members to service_role;
create policy members_read_self on public.app_members
  for select to authenticated using (user_id = (select auth.uid()));
comment on table public.app_members is
  'Explicit access approval, managed by trusted administration only. Auth signup never grants membership.';

