-- Import batches workflow (isolated from existing pages)

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null unique,
  batch_type text not null check (batch_type in ('purchase', 'sale')),
  source_file_name text not null,
  status text not null default 'draft' check (status in ('draft', 'partially_approved', 'approved', 'cancelled')),
  notes text,
  total_lines integer not null default 0,
  exact_matched_lines integer not null default 0,
  suggested_lines integer not null default 0,
  manual_matched_lines integer not null default 0,
  unknown_lines integer not null default 0,
  duplicate_warning_lines integer not null default 0,
  excluded_lines integer not null default 0,
  approved_lines_count integer not null default 0,
  pending_lines_count integer not null default 0,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create table if not exists public.import_batch_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_index integer not null,
  raw_item_name text,
  raw_color_code text,
  raw_color_name text,
  raw_qty_primary numeric(16,3),
  raw_rolls integer,
  raw_date date,
  raw_notes text,
  matched_item_id uuid references public.items(id),
  suggested_item_id uuid references public.items(id),
  match_status text not null default 'unknown' check (match_status in ('exact_match', 'suggested_match', 'manual_match', 'unknown', 'duplicate_warning', 'excluded')),
  match_score numeric(6,4),
  duplicate_warning_payload jsonb,
  suggested_approved boolean not null default false,
  duplicate_approved boolean not null default false,
  is_included boolean not null default true,
  is_posted boolean not null default false,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, row_index)
);

alter table public.stock_moves
  add column if not exists import_batch_id uuid,
  add column if not exists import_batch_line_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stock_moves_import_batch_id_fkey'
  ) then
    alter table public.stock_moves
      add constraint stock_moves_import_batch_id_fkey
      foreign key (import_batch_id) references public.import_batches(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'stock_moves_import_batch_line_id_fkey'
  ) then
    alter table public.stock_moves
      add constraint stock_moves_import_batch_line_id_fkey
      foreign key (import_batch_line_id) references public.import_batch_lines(id) on delete set null;
  end if;
end $$;

create unique index if not exists stock_moves_import_batch_line_uidx
  on public.stock_moves(import_batch_line_id)
  where import_batch_line_id is not null;

create index if not exists import_batch_lines_batch_idx on public.import_batch_lines(batch_id);
create index if not exists import_batch_lines_match_idx on public.import_batch_lines(match_status, is_included, is_posted);
create index if not exists stock_moves_import_batch_idx on public.stock_moves(import_batch_id);
