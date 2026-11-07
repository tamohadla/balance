begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.app_members where role='admin' and is_active limit 1),true);
set local role authenticated;
do $test$
declare i uuid:=gen_random_uuid();o uuid:=gen_random_uuid();g uuid:=gen_random_uuid();r uuid:=gen_random_uuid();bad uuid:=gen_random_uuid();lines jsonb; recons jsonb; result uuid;
begin
 insert into public.items(id,main_category,item_name,color_code,unit_type) values(i,'__transaction_test__',i::text,'TEST','kg');
 perform public.create_employee_order(o,'__transaction_test__','000',null,jsonb_build_array(jsonb_build_object('item_id',i,'qty_rolls',2)));
 update public.customer_orders set status='pending_sale' where id=o;
 lines:=jsonb_build_array(jsonb_build_object('item_id',i,'move_date',current_date,'qty_main',5,'qty_rolls',2));
 begin
  perform public.complete_order_sale(o,bad,null,jsonb_build_array(jsonb_build_object('item_id',i,'move_date',current_date,'qty_main',-1,'qty_rolls',2)));
  raise exception 'TEST_invalid_sale_accepted';
 exception when others then if sqlerrm<>'INVALID_ENTRY_LINES' then raise;end if;end;
 if (select status from public.customer_orders where id=o)<>'pending_sale' or exists(select 1 from public.stock_entry_groups where id=bad) then raise exception 'TEST_partial_sale';end if;
 result:=public.complete_order_sale(o,g,null,lines);
 if result<>g or (select status from public.customer_orders where id=o)<>'executed' or (select sales_group_id from public.customer_orders where id=o)<>g then raise exception 'TEST_order_not_completed';end if;
 perform public.complete_order_sale(o,g,null,lines);
 if (select count(*) from public.stock_moves where entry_group_id=g)<>1 then raise exception 'TEST_duplicate_sale';end if;
 begin perform public.complete_order_sale(o,gen_random_uuid(),null,lines);raise exception 'TEST_second_sale_accepted';
 exception when others then if sqlerrm<>'ORDER_ALREADY_SOLD' then raise;end if;end;
 recons:=jsonb_build_array(jsonb_build_object('item_id',i,'book_main',-5,'book_rolls',-2,'actual_main',10,'actual_rolls',4));
 perform public.save_reconciliation(r,current_date,recons);
 perform public.save_reconciliation(r,current_date,recons);
 if (select count(*) from public.stock_moves where session_id=r)<>1 then raise exception 'TEST_duplicate_reconciliation';end if;
 if (select sum(qty_main_in-qty_main_out) from public.stock_moves where item_id=i)<>10 then raise exception 'TEST_bad_balance';end if;
 begin perform public.save_reconciliation(bad,current_date,recons);raise exception 'TEST_stale_balance_accepted';
 exception when others then if sqlerrm<>'RECON_STOCK_CHANGED' then raise;end if;end;
 if exists(select 1 from public.recon_sessions where id=bad) then raise exception 'TEST_partial_reconciliation';end if;
 begin perform public.save_reconciliation(gen_random_uuid(),current_date,jsonb_build_array(jsonb_build_object('item_id',i,'book_main',10,'book_rolls',4,'actual_main',-1,'actual_rolls',4)));raise exception 'TEST_negative_actual_accepted';
 exception when others then if sqlerrm<>'INVALID_RECON' then raise;end if;end;
end $test$;
rollback;