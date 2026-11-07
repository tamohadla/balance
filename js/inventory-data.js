import {supabase} from "./supabaseClient.js?v=workspace-2";
import {allRows} from "./stock-entries.js?v=workspace-2";
export async function readStock(){
 const [items,lines]=await Promise.all([
  allRows(()=>supabase.from("inventory_balances").select("*").order("id")),
  allRows(()=>supabase.from("customer_order_lines").select("id,order_id,item_id,qty_rolls,customer_orders!inner(id,created_at,customer_name,status,note)").in("customer_orders.status",["draft","confirmed","pending_sale"]).order("id"))
 ]);
 const reserved=new Map();
 for(const l of lines)reserved.set(l.item_id,(reserved.get(l.item_id)||0)+Number(l.qty_rolls||0));
 return {items,lines,rows:items.map(i=>({...i,balance_main:Number(i.balance_main),balance_rolls:Number(i.balance_rolls),
  preorder_total_rolls:reserved.get(i.id)||0,balance_after_orders:Number(i.balance_rolls)-(reserved.get(i.id)||0)}))};
}
export function readItemMoves(itemId){
 return allRows(()=>supabase.from("stock_moves").select("id,item_id,type,move_date,created_at,entry_group_id,note,qty_main_in,qty_main_out,qty_rolls_in,qty_rolls_out").eq("item_id",itemId).order("id"));
}
