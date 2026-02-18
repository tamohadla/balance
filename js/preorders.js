import { supabase } from "./supabaseClient.js";
import { $, escapeHtml, setMsg, materialLabel, getPublicImageUrl, keysLookUnchanged, testSupabaseConnection, explainSupabaseError } from "./shared.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const msg = $("msg");
const tbody = $("tbody");
const cartSummary = $("cartSummary");
const cartSummaryFloating = $("cartSummaryFloating");
const CART_KEY = "preorder_cart_v1";

let cart = loadCart();
let rowsCache = []; 
let pendingByItem = {}; 

function loadCart(){
    try {
        const raw = localStorage.getItem(CART_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveCart(newCart){
    cart = newCart || {};
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function updateCartSummary(){
    const ids = Object.keys(cart);
    const totalRolls = ids.reduce((s, id) => s + (cart[id] || 0), 0);
    const txt = `${ids.length} صنف — ${totalRolls} ثوب`;
    if(cartSummary) cartSummary.textContent = txt;
    if(cartSummaryFloating) cartSummaryFloating.textContent = txt;
}

// --- جلب البيانات ---
async function load(){
    setMsg(msg, "جاري تحديث البيانات...", true);
    try {
        const { data: items, error: err1 } = await supabase.from("items").select("*")
            .order("main_category").order("sub_category").order("item_name").order("color_code");
        if(err1) throw err1;

        // جلب الحركات (المخزون)
        const { data: moves, error: err2 } = await supabase.from("stock_moves").select("item_id, qty_rolls_in, qty_rolls_out");
        if(err2) throw err2;

        // جلب المحجوز (Draft)
        const { data: pending, error: err3 } = await supabase.from("customer_order_lines")
            .select("item_id, qty_rolls, customer_orders!inner(status)")
            .eq("customer_orders.status", "draft");
        if(err3) throw err3;

        // تجميع البيانات
        pendingByItem = {};
        pending.forEach(p => pendingByItem[p.item_id] = (pendingByItem[p.item_id] || 0) + (p.qty_rolls || 0));

        const agg = new Map();
        items.forEach(it => agg.set(it.id, { ...it, balance_rolls: 0 }));
        moves.forEach(m => {
            const r = agg.get(m.item_id);
            if(r) r.balance_rolls += (m.qty_rolls_in || 0) - (m.qty_rolls_out || 0);
        });

        rowsCache = [...agg.values()];
        setMsg(msg, `تم تحميل ${rowsCache.length} صنف`, true);
        render();
        updateCartSummary();
    } catch(ex) {
        setMsg(msg, explainSupabaseError(ex), false);
    }
}

// --- العرض ---
function render(){
    const q = $("search").value.trim().toLowerCase();
    const onlySelected = $("onlySelected").checked;

    let rows = rowsCache.filter(r => {
        const matchSearch = `${materialLabel(r)} ${r.color_code}`.toLowerCase().includes(q);
        const matchSelected = onlySelected ? (cart[r.id] > 0) : true;
        return matchSearch && matchSelected;
    });

    tbody.innerHTML = rows.map(r => {
        const bal = r.balance_rolls || 0;
        const prev = pendingByItem[r.id] || 0;
        const qty = cart[r.id] || 0;
        const afterPrev = bal - prev;
        const afterThis = afterPrev - qty;
        const isOver = afterThis < 0;

        return `
            <tr data-id="${r.id}" class="${isOver ? 'row-over' : ''}">
                <td><img src="${getPublicImageUrl(r.image_path)}" class="thumb" loading="lazy"></td>
                <td><div class="m-label">${escapeHtml(materialLabel(r))}</div></td>
                <td><span class="badge-code">${escapeHtml(r.color_code)}</span></td>
                <td>${escapeHtml(r.color_name || '-')}</td>
                <td class="txt-center">${bal}</td>
                <td class="txt-center">
                    <strong class="${afterPrev <= 0 ? 'txt-danger' : ''}">${afterPrev}</strong>
                    <div class="small-hint">بعد الطلب: <b class="${isOver ? 'txt-danger' : ''}">${afterThis}</b></div>
                </td>
                <td>
                    <div class="stepper">
                        <button onclick="changeQty('${r.id}', -1)" style="width: 45px;">-</button>
                        <span class="qty-val" style="padding: 12px;">${qty}</span>
                        <button onclick="changeQty('${r.id}', 1)" style="width: 45px;">+</button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

// أصبحت دالة عالمية لتسهيل الاستدعاء من HTML
window.changeQty = (id, delta) => {
    const current = cart[id] || 0;
    const next = current + delta;
    if (next <= 0) delete cart[id];
    else cart[id] = next;
    saveCart(cart);
    render();
    updateCartSummary();
};

// --- المودال ---
window.openOrderModal = () => {
    const selected = rowsCache.filter(r => cart[r.id] > 0);
    if(selected.length === 0) return alert("السلة فارغة!");

    $("previewWrap").innerHTML = selected.map(x => `
        <div class="preview-item">
            <span>${materialLabel(x)} (${x.color_code})</span>
            <strong>${cart[x.id]} ثوب</strong>
        </div>
    `).join("");
    
    $("orderModal").style.display = "flex";
};

// إغلاق المودال
window.closeModal = () => $("orderModal").style.display = "none";

// حفظ الطلب
window.confirmOrder = async () => {
    const name = $("customer_name").value.trim();
    const phone = $("customer_phone").value.trim();
    if(!name || !phone) return alert("يرجى إدخال بيانات الزبون");

    // نفس منطق الحفظ السابق...
    // بعد النجاح:
    // localStorage.removeItem(CART_KEY);
};


// تفريغ السلة فقط (بدون لمس الفلاتر)
function clearCartOnly(){
    const hasAny = cart && Object.keys(cart).length > 0;
    if(!hasAny){
        setMsg(msg, "السلة فارغة بالفعل.", true);
        updateCartSummary();
        return;
    }
    const ok = confirm("هل تريد تفريغ السلة (الكميات المختارة) فقط؟");
    if(!ok) return;

    cart = {};
    localStorage.removeItem(CART_KEY);

    render();
    updateCartSummary();
    setMsg(msg, "تم تفريغ السلة.", true);
}

// ربط الأزرار
document.addEventListener("DOMContentLoaded", () => {
    $("btnConfirm")?.addEventListener("click", openOrderModal);
    $("btnConfirmFloating")?.addEventListener("click", openOrderModal);
    $("btnClear")?.addEventListener("click", clearCartOnly);
    $("btnClearFloating")?.addEventListener("click", clearCartOnly);
    $("modalClose")?.addEventListener("click", closeModal);
    $("btnCancel")?.addEventListener("click", closeModal);
    $("search")?.addEventListener("input", render);
    $("onlySelected")?.addEventListener("change", render);
    
    load();
});
