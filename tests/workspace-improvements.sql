begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.app_members where role='admin' and is_active limit 1),true);
set local role authenticated;
do $test$
declare i uuid:=gen_random_uuid();o uuid:=gen_random_uuid();g uuid:=gen_random_uuid();old_lines jsonb;new_lines jsonb;
begin
insert into public.items(id,main_category,item_name,color_code,unit_type) values(i,'__transaction_test__',i::text,'TEST','kg');
old_lines:=jsonb_build_array(jsonb_build_object('item_id',i,'qty_rolls',2));
new_lines:=jsonb_build_array(jsonb_build_object('item_id',i,'qty_rolls',4));
perform public.create_employee_order(o,'__transaction_test__','000',null,old_lines);
perform public.update_order_lines(o,old_lines,new_lines);
if (select qty_rolls from public.customer_order_lines where order_id=o)<>4 then raise exception 'TEST_wrong_quantity';end if;
begin perform public.update_order_lines(o,old_lines,new_lines);raise exception 'TEST_stale_accepted';
exception when others then if sqlerrm<>'ORDER_LINES_CHANGED' then raise;end if;end;
begin perform public.update_order_lines(o,new_lines,'[]');raise exception 'TEST_empty_accepted';
exception when others then if sqlerrm<>'INVALID_LINES' then raise;end if;end;
update public.customer_orders set status='unknown' where id=o;
begin perform public.update_order_lines(o,new_lines,old_lines);raise exception 'TEST_unknown_status_edit';
exception when others then if sqlerrm<>'ORDER_NOT_EDITABLE' then raise;end if;end;
update public.customer_orders set status='draft' where id=o;
update public.customer_orders set status='pending_sale' where id=o;
begin perform public.update_order_lines(o,new_lines,old_lines);raise exception 'TEST_pending_edit';
exception when others then if sqlerrm<>'ORDER_NOT_EDITABLE' then raise;end if;end;
perform public.create_stock_entry(g,'purchase','manual',null,null,jsonb_build_array(jsonb_build_object('item_id',i,'move_date',current_date,'qty_main',10,'qty_rolls',3)));
if (select balance_rolls from public.inventory_balances where id=i)<>3 then raise exception 'TEST_balance';end if;
if not exists(select 1 from public.operation_events where entity='items' and record_id=i::text and action='insert') then raise exception 'TEST_no_audit';end if;
if not exists(select 1 from public.operation_events where entity='customer_orders' and record_id=o::text and action='update' and before_data->>'status'='draft' and after_data->>'status'='pending_sale') then raise exception 'TEST_audit_snapshot';end if;
begin delete from public.operation_events where record_id=i::text;raise exception 'TEST_audit_mutable';
exception when insufficient_privilege then null;end;
end $test$;
reset role;
select set_config('request.jwt.claim.sub',(select user_id::text from public.app_members where role='viewer' and is_active limit 1),true);
set local role authenticated;
do $test$ begin
if exists(select 1 from public.operation_events) then raise exception 'TEST_viewer_audit';end if;
begin perform public.update_order_lines(gen_random_uuid(),'[]','[]');raise exception 'TEST_viewer_edit';
exception when others then if sqlerrm<>'ORDER_ACCESS_DENIED' then raise;end if;end;
end $test$;
rollback;