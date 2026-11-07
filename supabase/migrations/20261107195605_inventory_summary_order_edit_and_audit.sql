create view public.inventory_balances with (security_invoker=true) as
select i.*,round(coalesce(m.balance_main,0),3) balance_main,coalesce(m.balance_rolls,0)::bigint balance_rolls,
 m.last_move_date,m.last_purchase_date,m.last_purchase_key
from public.items i left join (
 select item_id,sum(qty_main_in-qty_main_out) balance_main,sum(qty_rolls_in::bigint-qty_rolls_out::bigint) balance_rolls,
 max(move_date) last_move_date,max(move_date) filter(where type='purchase') last_purchase_date,
 max(move_date::text||'|'||created_at::text) filter(where type='purchase') last_purchase_key
 from public.stock_moves group by item_id
) m on m.item_id=i.id;
revoke all on public.inventory_balances from public,anon;
grant select on public.inventory_balances to authenticated;

create or replace function public.update_order_lines(p_order_id uuid,p_expected jsonb,p_lines jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare o public.customer_orders%rowtype;before_lines jsonb;expected_lines jsonb;
begin
 if auth.uid() is null or not public.section_access('orders',true) then raise exception 'ORDER_ACCESS_DENIED';end if;
 select * into o from public.customer_orders where id=p_order_id for update;
 if not found or o.status not in ('draft','confirmed') then raise exception 'ORDER_NOT_EDITABLE';end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_typeof(p_expected) is distinct from 'array' then raise exception 'INVALID_LINES';end if;
 if jsonb_array_length(p_lines) not between 1 and 500 then raise exception 'INVALID_LINES';end if;
 select coalesce(jsonb_agg(jsonb_build_object('item_id',item_id,'qty_rolls',qty_rolls) order by item_id),'[]') into before_lines from public.customer_order_lines where order_id=p_order_id;
 select coalesce(jsonb_agg(jsonb_build_object('item_id',x.item_id,'qty_rolls',x.qty_rolls) order by x.item_id),'[]')
 into expected_lines from jsonb_to_recordset(p_expected) as x(item_id uuid,qty_rolls integer);
 if before_lines<>expected_lines then raise exception 'ORDER_LINES_CHANGED';end if;
 if exists(select 1 from jsonb_to_recordset(p_lines) as x(item_id uuid,qty_rolls numeric)
 where x.item_id is null or x.qty_rolls is null or not(x.qty_rolls between 1 and 100000 and trunc(x.qty_rolls)=x.qty_rolls)
 or not exists(select 1 from public.items i where i.id=x.item_id and (i.is_active or exists(select 1 from public.customer_order_lines l where l.order_id=p_order_id and l.item_id=i.id))))
 or (select count(distinct x->>'item_id') from jsonb_array_elements(p_lines)x)<>jsonb_array_length(p_lines) then raise exception 'INVALID_LINES';end if;
 delete from public.customer_order_lines where order_id=p_order_id;
 insert into public.customer_order_lines(order_id,item_id,qty_rolls)
 select p_order_id,x.item_id,x.qty_rolls from jsonb_to_recordset(p_lines) as x(item_id uuid,qty_rolls integer);
end $$;
revoke all on function public.update_order_lines(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.update_order_lines(uuid,jsonb,jsonb) to authenticated;

create schema if not exists app_private;
create table public.operation_events(
 id bigint generated always as identity primary key,created_at timestamptz not null default now(),
 actor_id uuid,actor_name text,entity text not null,record_id text not null,action text not null,
 before_data jsonb,after_data jsonb
);
alter table public.operation_events enable row level security;
create policy admin_read on public.operation_events for select to authenticated using (
 exists(select 1 from public.app_members where user_id=(select auth.uid()) and is_active and role='admin')
);
revoke all on public.operation_events from public,anon,authenticated;
grant select on public.operation_events to authenticated;
create index operation_events_recent_idx on public.operation_events(created_at desc,id desc);
create index operation_events_entity_recent_idx on public.operation_events(entity,created_at desc);
create function app_private.record_operation() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();before_value jsonb;after_value jsonb;display_name text;
begin
 if actor is null then return coalesce(new,old);end if;
 if tg_op<>'INSERT' then before_value:=to_jsonb(old)-'checkout_fingerprint'-'request_fingerprint'-'fingerprint';end if;
 if tg_op<>'DELETE' then after_value:=to_jsonb(new)-'checkout_fingerprint'-'request_fingerprint'-'fingerprint';end if;
 if tg_op='UPDATE' and before_value=after_value then return new;end if;
 select m.display_name into display_name from public.app_members m where m.user_id=actor;
 insert into public.operation_events(actor_id,actor_name,entity,record_id,action,before_data,after_data)
 values(actor,display_name,tg_table_name,coalesce(after_value->>'id',before_value->>'id'),lower(tg_op),before_value,after_value);
 return coalesce(new,old);
end $$;
revoke all on function app_private.record_operation() from public,anon,authenticated;
create trigger log_item_operation after insert or update or delete on public.items for each row execute function app_private.record_operation();
create trigger log_move_operation after insert or update or delete on public.stock_moves for each row execute function app_private.record_operation();
create trigger log_order_operation after insert or update or delete on public.customer_orders for each row execute function app_private.record_operation();
create trigger log_order_line_operation after insert or update or delete on public.customer_order_lines for each row execute function app_private.record_operation();
create trigger log_recon_operation after insert or update or delete on public.recon_sessions for each row execute function app_private.record_operation();
notify pgrst,'reload schema';