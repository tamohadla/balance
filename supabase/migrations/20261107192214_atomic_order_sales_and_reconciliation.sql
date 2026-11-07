-- Atomic order checkout and reconciliation. Existing executed orders are not rewritten.
alter table public.customer_orders add column if not exists sales_group_id uuid references public.stock_entry_groups(id);
create unique index if not exists customer_orders_sales_group_idx on public.customer_orders(sales_group_id) where sales_group_id is not null;
alter table public.recon_sessions add column if not exists created_by uuid references auth.users(id);
alter table public.recon_sessions add column if not exists request_fingerprint text;
create index if not exists recon_sessions_created_by_idx on public.recon_sessions(created_by);

create or replace function public.complete_order_sale(p_order_id uuid,p_id uuid,p_note text,p_lines jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare o public.customer_orders%rowtype; g uuid;
begin
 if auth.uid() is null or not public.section_access('orders',true) or not public.section_access('sales',true) then raise exception 'ORDER_ACCESS_DENIED'; end if;
 select * into o from public.customer_orders where id=p_order_id for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if o.sales_group_id is not null then
  if o.sales_group_id<>p_id then raise exception 'ORDER_ALREADY_SOLD'; end if;
  return public.create_stock_entry(p_id,'sale','manual',p_note,null,p_lines);
 end if;
 if o.status not in ('draft','confirmed','pending_sale') then raise exception 'ORDER_ALREADY_SOLD'; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'INVALID_ENTRY_LINES';end if;
 if exists(select item_id from public.customer_order_lines where order_id=p_order_id
           except select (l->>'item_id')::uuid from jsonb_array_elements(p_lines) l)
 or exists(select (l->>'item_id')::uuid from jsonb_array_elements(p_lines) l
           except select item_id from public.customer_order_lines where order_id=p_order_id) then
   raise exception 'ORDER_ITEMS_CHANGED';
 end if;
 g:=public.create_stock_entry(p_id,'sale','manual',p_note,null,p_lines);
 update public.customer_orders set status='executed',sales_group_id=g where id=p_order_id;
 return g;
end $$;
revoke all on function public.complete_order_sale(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.complete_order_sale(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.save_reconciliation(p_id uuid,p_date date,p_lines jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare existing public.recon_sessions%rowtype; fp text; l record; bal_main numeric; bal_rolls bigint; delta_main numeric;delta_rolls bigint;
begin
 if auth.uid() is null or not public.stock_write_access('adjustment') then raise exception 'RECON_ACCESS_DENIED';end if;
 if p_id is null or p_date is null or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'INVALID_RECON';end if;
 if jsonb_array_length(p_lines) not between 1 and 10000 then raise exception 'INVALID_RECON';end if;
 if exists(select 1 from jsonb_to_recordset(p_lines) as x(item_id uuid,book_main numeric,book_rolls numeric,actual_main numeric,actual_rolls numeric)
  where x.item_id is null or x.book_main is null or x.book_rolls is null or x.actual_main is null or x.actual_rolls is null
   or not (x.actual_main>=0 and x.actual_main<1000000000) or not(x.actual_rolls>=0 and x.actual_rolls<=1000000 and trunc(x.actual_rolls)=x.actual_rolls)
   or not (x.book_main between -1000000000000 and 1000000000000) or not(x.book_rolls between -1000000000 and 1000000000 and trunc(x.book_rolls)=x.book_rolls)
   or not exists(select 1 from public.items i where i.id=x.item_id))
  or (select count(distinct x->>'item_id') from jsonb_array_elements(p_lines)x)<>jsonb_array_length(p_lines) then raise exception 'INVALID_RECON';end if;
 fp:=md5(jsonb_build_array(p_date,p_lines)::text);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,54219));
 select * into existing from public.recon_sessions where id=p_id;
 if found then
  if existing.created_by is distinct from auth.uid() or existing.request_fingerprint is distinct from fp then raise exception 'RECON_REQUEST_CONFLICT';end if;
  return p_id;
 end if;
 -- Short transaction-wide lock also covers legacy writers that do not take item locks.
 lock table public.stock_moves in share row exclusive mode;
 for l in select * from jsonb_to_recordset(p_lines) as x(item_id uuid,book_main numeric,book_rolls numeric,actual_main numeric,actual_rolls numeric) loop
  select round(coalesce(sum(qty_main_in-qty_main_out),0),3),coalesce(sum(qty_rolls_in::bigint-qty_rolls_out::bigint),0)
   into bal_main,bal_rolls from public.stock_moves where item_id=l.item_id;
  if bal_main<>round(l.book_main,3) or bal_rolls<>l.book_rolls then raise exception 'RECON_STOCK_CHANGED';end if;
 end loop;
 insert into public.recon_sessions(id,recon_date,note,created_by,request_fingerprint)
 values(p_id,p_date,'تسوية جرد',auth.uid(),fp);
 for l in select * from jsonb_to_recordset(p_lines) as x(item_id uuid,book_main numeric,book_rolls numeric,actual_main numeric,actual_rolls numeric) loop
  delta_main:=round(l.actual_main,3)-round(l.book_main,3);delta_rolls:=l.actual_rolls-l.book_rolls;
  insert into public.recon_lines(session_id,recon_date,item_id,book_qty_main,book_qty_rolls,actual_qty_main,actual_qty_rolls,diff_qty_main,diff_qty_rolls)
   values(p_id,p_date,l.item_id,round(l.book_main,3),l.book_rolls,round(l.actual_main,3),l.actual_rolls,delta_main,delta_rolls);
  if delta_main<>0 or delta_rolls<>0 then
   insert into public.stock_moves(type,move_date,item_id,session_id,note,qty_main_in,qty_main_out,qty_rolls_in,qty_rolls_out)
   values('adjustment',p_date,l.item_id,p_id,'تسوية جرد',greatest(delta_main,0),greatest(-delta_main,0),greatest(delta_rolls,0),greatest(-delta_rolls,0));
  end if;
 end loop;
 return p_id;
end $$;
revoke all on function public.save_reconciliation(uuid,date,jsonb) from public,anon;
grant execute on function public.save_reconciliation(uuid,date,jsonb) to authenticated;
notify pgrst,'reload schema';
