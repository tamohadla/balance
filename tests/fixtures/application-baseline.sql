-- Local test fixture for the application schema that predates the migrations.
-- This is intentionally not a production bootstrap or a Supabase schema dump.
-- Auth and Storage expose only the surfaces used by the application SQL.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema storage;
grant usage on schema public, auth, storage to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email_confirmed_at timestamptz,
  deleted_at timestamptz,
  banned_until timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;

create table public.items (
  id uuid primary key default gen_random_uuid(),
  main_category text not null,
  sub_category text,
  item_name text not null,
  color_code text not null,
  color_name text,
  unit_type text not null check (unit_type in ('kg', 'm')),
  description text,
  image_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (item_name, color_code)
);
create table public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  move_date date not null,
  type text not null check (type in ('purchase', 'sale', 'adjustment')),
  qty_main_in numeric not null default 0,
  qty_main_out numeric not null default 0,
  qty_rolls_in integer not null default 0,
  qty_rolls_out integer not null default 0,
  note text,
  session_id uuid,
  created_at timestamptz not null default now()
);
create index stock_moves_item_idx on public.stock_moves(item_id);
create table public.recon_sessions (
  id uuid primary key default gen_random_uuid(),
  recon_date date not null,
  note text,
  created_at timestamptz not null default now()
);
create table public.recon_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.recon_sessions(id) on delete cascade,
  recon_date date not null,
  item_id uuid not null references public.items(id) on delete cascade,
  book_qty_main numeric not null,
  book_qty_rolls integer not null,
  actual_qty_main numeric not null,
  actual_qty_rolls integer not null,
  diff_qty_main numeric not null,
  diff_qty_rolls integer not null,
  created_at timestamptz not null default now()
);
create table public.customer_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_name text not null,
  customer_phone text not null,
  status text not null default 'draft',
  note text
);
create table public.customer_order_lines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  order_id uuid not null references public.customer_orders(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  qty_rolls integer not null check (qty_rolls >= 0)
);

insert into auth.users(id, email_confirmed_at) values
  ('11111111-1111-4111-8111-111111111111', now()),
  ('22222222-2222-4222-8222-222222222222', now());
