import { supabase } from "./supabaseClient.js";
import { allRows } from "./stock-entries.js";
import { buildStock } from "./inventory-model.js?v=2";
export async function readStock() {
  const [items, moves, lines] = await Promise.all([
    allRows(() => supabase.from("items").select("*").order("id")),
    allRows(() =>
      supabase
        .from("stock_moves")
        .select(
          "id,item_id,type,move_date,created_at,entry_group_id,note,qty_main_in,qty_main_out,qty_rolls_in,qty_rolls_out",
        )
        .order("id"),
    ),
    allRows(() =>
      supabase
        .from("customer_order_lines")
        .select(
          "id,order_id,item_id,qty_rolls,customer_orders!inner(id,created_at,customer_name,status,note)",
        )
        .in("customer_orders.status", ["draft", "confirmed"])
        .order("id"),
    ),
  ]);
  return { items, moves, lines, rows: buildStock(items, moves, lines) };
}
