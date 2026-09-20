// Date of the most recent purchase, independent of item creation and other moves.
export function recordPurchase(item,move){
 if(move.type!=='purchase'||!/^\d{4}-\d{2}-\d{2}$/.test(move.move_date||''))return;
 const key=move.move_date+'|'+(move.created_at||'');
 if(!item.last_purchase_key||key>item.last_purchase_key){item.last_purchase_key=key;item.last_purchase_date=move.move_date;}
}
export function comparePurchases(a,b,direction='purchase_newest'){
 const x=a.last_purchase_key||'',y=b.last_purchase_key||'';
 // Materials without any purchase stay last in both directions.
 if(!x||!y){if(x)return -1;if(y)return 1;}
 const cmp=x.localeCompare(y);if(cmp)return direction==='purchase_oldest'?cmp:-cmp;
 return String(a.item_name||'').localeCompare(String(b.item_name||''),'ar',{numeric:true})||String(a.color_code||'').localeCompare(String(b.color_code||''),'ar',{numeric:true})||String(a.id).localeCompare(String(b.id));
}
