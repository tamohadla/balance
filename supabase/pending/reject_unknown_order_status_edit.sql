create or replace function public.update_order_lines(p_order_id uuid,p_expected jsonb,p_lines jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare o public.customer_orders%rowtype;before_lines jsonb;expected_lines jsonb;
begin
 if auth.uid() is null or not public.section_access('orders',true) then raise exception 'ORDER_ACCESS_DENIED';end if;
 select * into o from public.customer_orders where id=p_order_id for update;
 if not found or coalesce(o.status,'') not in ('draft','confirmed') then raise exception 'ORDER_NOT_EDITABLE';end if;
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

