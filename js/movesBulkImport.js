import { supabase } from "./supabaseClient.js";
import { cleanText, normalizeArabicDigits, setMsg, escapeHtml } from "./shared.js";

const REQUIRED_HEADERS = ["item_name", "color_code", "qty_main", "qty_rolls"];

const HEADER_ALIASES = {
  date: ["date", "التاريخ"],
  item_name: ["item_name", "اسم المادة", "المادة"],
  color_code: ["color_code", "رقم اللون", "اللون"],
  qty_main: ["qty_main", "الكمية الرئيسية"],
  qty_rolls: ["qty_rolls", "الكمية الفرعية", "عدد الاثواب", "عدد الأثواب"],
  note: ["note", "ملاحظات", "ملاحظة"]
};

function toISODate(value, fallbackDate){
  if(value === null || value === undefined || value === "") return fallbackDate;

  if(typeof value === "number" && window.XLSX?.SSF?.parse_date_code){
    const p = window.XLSX.SSF.parse_date_code(value);
    if(p){
      const mm = String(p.m).padStart(2, "0");
      const dd = String(p.d).padStart(2, "0");
      return `${p.y}-${mm}-${dd}`;
    }
  }

  const text = normalizeArabicDigits(String(value).trim());
  if(!text) return fallbackDate;

  if(/^\d+$/.test(text) && window.XLSX?.SSF?.parse_date_code){
    const p = window.XLSX.SSF.parse_date_code(Number(text));
    if(p){
      const mm = String(p.m).padStart(2, "0");
      const dd = String(p.d).padStart(2, "0");
      return `${p.y}-${mm}-${dd}`;
    }
  }

  const ymd = text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if(ymd){
    return `${ymd[1]}-${String(Number(ymd[2])).padStart(2, "0")}-${String(Number(ymd[3])).padStart(2, "0")}`;
  }

  const dmy = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if(dmy){
    return `${dmy[3]}-${String(Number(dmy[2])).padStart(2, "0")}-${String(Number(dmy[1])).padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if(!Number.isNaN(parsed.getTime())){
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function normalizeHeader(value){
  return String(value || "").trim().toLowerCase();
}

function resolveHeaderIndexes(headerRow){
  const normalized = headerRow.map(normalizeHeader);
  const indexes = {};

  for(const [key, aliases] of Object.entries(HEADER_ALIASES)){
    indexes[key] = normalized.findIndex(h => aliases.some(a => normalizeHeader(a) === h));
  }
  return indexes;
}

async function fetchItemsByNames(names){
  const rows = [];
  for(let i = 0; i < names.length; i += 200){
    const chunk = names.slice(i, i + 200);
    const { data, error } = await supabase
      .from("items")
      .select("id, item_name, color_code, is_active")
      .eq("is_active", true)
      .in("item_name", chunk);
    if(error) throw error;
    rows.push(...(data || []));
  }

  const map = new Map();
  for(const it of rows){
    const key = `${cleanText(it.item_name).toLowerCase()}||${normalizeArabicDigits(cleanText(it.color_code)).toLowerCase()}`;
    map.set(key, it.id);
  }
  return map;
}

function ensureReviewModal(){
  let modal = document.getElementById("bulkReviewModal");
  if(modal) return modal;

  modal = document.createElement("div");
  modal.id = "bulkReviewModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 980px;">
      <div class="modal-header">
        <h3 style="margin:0;">مراجعة تفاصيل الفاتورة قبل التأكيد</h3>
        <button type="button" id="bulkCloseReview" class="secondary" style="width:auto;">إغلاق</button>
      </div>
      <div class="modal-body">
        <div id="bulkReviewSummary" class="card" style="margin:0 0 10px;"></div>
        <div class="tableWrap" style="max-height:50vh; overflow:auto;">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>التاريخ</th>
                <th>المادة</th>
                <th>رقم اللون</th>
                <th>الكمية الرئيسية</th>
                <th>الكمية الفرعية</th>
                <th>ملاحظة</th>
                <th>حالة المادة</th>
              </tr>
            </thead>
            <tbody id="bulkReviewRows"></tbody>
          </table>
        </div>
        <p id="bulkReviewMsg" class="msg" style="margin-top:10px;"></p>
        <div class="actionsRow" style="margin-top:10px;">
          <button type="button" id="bulkConfirmImport">تأكيد الطلب</button>
          <button type="button" id="bulkCancelReview" class="secondary">إلغاء</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

export function initMovesBulkImport({ moveType, msgEl, dateInput, onDone }){
  const bulkFileInput = document.getElementById("bulkFileInput");
  const btnBulkImport = document.getElementById("btnBulkImport");
  const btnDownloadTemplate = document.getElementById("btnDownloadTemplate");

  if(!bulkFileInput || !btnBulkImport || !btnDownloadTemplate) return;

  const modal = ensureReviewModal();
  const summaryEl = document.getElementById("bulkReviewSummary");
  const rowsEl = document.getElementById("bulkReviewRows");
  const reviewMsgEl = document.getElementById("bulkReviewMsg");
  const btnConfirm = document.getElementById("bulkConfirmImport");
  const btnClose = document.getElementById("bulkCloseReview");
  const btnCancel = document.getElementById("bulkCancelReview");

  let pendingPayloads = [];

  const closeModal = () => {
    modal.style.display = "none";
    pendingPayloads = [];
    btnConfirm.disabled = false;
  };

  btnClose.onclick = closeModal;
  btnCancel.onclick = closeModal;

  btnDownloadTemplate.addEventListener("click", () => {
    if(!window.XLSX){
      setMsg(msgEl, "تعذر إنشاء القالب: مكتبة Excel غير متاحة", false);
      return;
    }

    const sample = [
      ["date", "item_name", "color_code", "qty_main", "qty_rolls", "note"],
      ["2026-04-11", "اسم المادة كما هو بالنظام", "101", 12.5, 3, "ملاحظة اختيارية"]
    ];

    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.aoa_to_sheet(sample);
    window.XLSX.utils.book_append_sheet(wb, ws, "template");
    window.XLSX.writeFile(wb, `bulk-${moveType}-template.xlsx`);
  });

  btnBulkImport.addEventListener("click", () => bulkFileInput.click());

  btnConfirm.onclick = async () => {
    if(!pendingPayloads.length) return;

    try{
      btnConfirm.disabled = true;
      setMsg(reviewMsgEl, `جارٍ تأكيد الطلب وإدخال ${pendingPayloads.length} بند...`, true);
      for(let i = 0; i < pendingPayloads.length; i += 200){
        const chunk = pendingPayloads.slice(i, i + 200);
        const { error } = await supabase.from("stock_moves").insert(chunk);
        if(error) throw error;
      }

      setMsg(reviewMsgEl, `✅ تم تأكيد الطلب بنجاح (${pendingPayloads.length} بند).`, true);
      setMsg(msgEl, `تم استيراد ${pendingPayloads.length} سطر بنجاح`, true);
      await onDone?.();
      setTimeout(closeModal, 400);
    }catch(ex){
      btnConfirm.disabled = false;
      setMsg(reviewMsgEl, ex?.message || "حدث خطأ أثناء التأكيد", false);
    }
  };

  bulkFileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;

    if(!window.XLSX){
      setMsg(msgEl, "تعذر قراءة الملف: مكتبة Excel غير متاحة", false);
      bulkFileInput.value = "";
      return;
    }

    try{
      setMsg(msgEl, "جارٍ قراءة ملف الإكسل والتحقق من المواد...", true);

      const buffer = await file.arrayBuffer();
      const wb = window.XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });

      if(rows.length < 2){
        setMsg(msgEl, "الملف فارغ أو لا يحتوي صفوف بيانات", false);
        return;
      }

      const headerIndexes = resolveHeaderIndexes(rows[0]);
      const missing = REQUIRED_HEADERS.filter(k => headerIndexes[k] === -1);
      if(missing.length){
        setMsg(msgEl, `الأعمدة المطلوبة غير موجودة: ${missing.join(", ")}`, false);
        return;
      }

      const defaultDate = dateInput?.value || new Date().toISOString().slice(0, 10);
      const parsedRows = [];
      const validationErrors = [];

      for(let i = 1; i < rows.length; i++){
        const row = rows[i];
        if(!row || row.every(v => cleanText(v) === "")) continue;

        const lineNo = i + 1;
        const itemName = cleanText(row[headerIndexes.item_name]);
        const colorCode = normalizeArabicDigits(cleanText(row[headerIndexes.color_code]));
        const qtyMain = Number(normalizeArabicDigits(cleanText(row[headerIndexes.qty_main])));
        const qtyRolls = Number(normalizeArabicDigits(cleanText(row[headerIndexes.qty_rolls])));
        const note = cleanText(row[headerIndexes.note]) || null;
        const moveDate = toISODate(row[headerIndexes.date], defaultDate);

        if(!itemName || !colorCode){
          validationErrors.push(`السطر ${lineNo}: اسم المادة/رقم اللون مطلوب.`);
          continue;
        }
        if(!(qtyMain > 0)){
          validationErrors.push(`السطر ${lineNo}: الكمية الرئيسية يجب أن تكون أكبر من صفر.`);
          continue;
        }
        if(!Number.isInteger(qtyRolls) || qtyRolls <= 0){
          validationErrors.push(`السطر ${lineNo}: الكمية الفرعية يجب أن تكون عددًا صحيحًا أكبر من صفر.`);
          continue;
        }
        if(!moveDate){
          validationErrors.push(`السطر ${lineNo}: التاريخ غير صالح.`);
          continue;
        }

        parsedRows.push({ lineNo, itemName, colorCode, qtyMain, qtyRolls, note, moveDate });
      }

      if(validationErrors.length){
        setMsg(msgEl, `يوجد أخطاء في الملف (${validationErrors.length}): ${validationErrors.slice(0, 3).join(" | ")}`, false);
        return;
      }

      if(!parsedRows.length){
        setMsg(msgEl, "لا توجد صفوف صالحة للاستيراد", false);
        return;
      }

      const uniqueNames = [...new Set(parsedRows.map(r => r.itemName))];
      const itemMap = await fetchItemsByNames(uniqueNames);

      const unresolved = [];
      const payloads = [];
      const invoiceRows = parsedRows.map(r => {
        const key = `${r.itemName.toLowerCase()}||${r.colorCode.toLowerCase()}`;
        const itemId = itemMap.get(key);
        const exists = Boolean(itemId);

        if(!exists){
          unresolved.push(`السطر ${r.lineNo}: المادة غير موجودة (${r.itemName} / ${r.colorCode})`);
        }else{
          const payload = {
            type: moveType,
            move_date: r.moveDate,
            item_id: itemId,
            note: r.note,
            qty_main_in: 0,
            qty_main_out: 0,
            qty_rolls_in: 0,
            qty_rolls_out: 0
          };

          if(moveType === "purchase"){
            payload.qty_main_in = r.qtyMain;
            payload.qty_rolls_in = r.qtyRolls;
          }else{
            payload.qty_main_out = r.qtyMain;
            payload.qty_rolls_out = r.qtyRolls;
          }

          payloads.push(payload);
        }

        return { ...r, exists };
      });

      const totalMain = invoiceRows.reduce((sum, r) => sum + r.qtyMain, 0);
      const totalRolls = invoiceRows.reduce((sum, r) => sum + r.qtyRolls, 0);
      const typeLabel = moveType === "purchase" ? "مشتريات" : "مبيعات";

      summaryEl.innerHTML = `
        <div><strong>نوع الطلب:</strong> ${typeLabel}</div>
        <div><strong>عدد البنود:</strong> ${invoiceRows.length}</div>
        <div><strong>إجمالي الكمية الرئيسية:</strong> ${totalMain.toFixed(3)}</div>
        <div><strong>إجمالي الكمية الفرعية:</strong> ${totalRolls}</div>
      `;

      rowsEl.innerHTML = invoiceRows.map(r => `
        <tr>
          <td>${r.lineNo}</td>
          <td>${escapeHtml(r.moveDate)}</td>
          <td>${escapeHtml(r.itemName)}</td>
          <td>${escapeHtml(r.colorCode)}</td>
          <td>${r.qtyMain.toFixed(3)}</td>
          <td>${r.qtyRolls}</td>
          <td>${escapeHtml(r.note || "")}</td>
          <td><span class="badge ${r.exists ? "ok" : "danger"}">${r.exists ? "موجود" : "غير موجود"}</span></td>
        </tr>
      `).join("");

      if(unresolved.length){
        setMsg(reviewMsgEl, `⚠️ لا يمكن التأكيد قبل معالجة المواد غير الموجودة (${unresolved.length}).`, false);
        btnConfirm.disabled = true;
        pendingPayloads = [];
      }else{
        setMsg(reviewMsgEl, "جميع المواد موجودة. يمكنك الآن تأكيد الطلب.", true);
        btnConfirm.disabled = false;
        pendingPayloads = payloads;
      }

      modal.style.display = "flex";
      setMsg(msgEl, `تم تجهيز المعاينة (${invoiceRows.length} بند).`, true);
    }catch(ex){
      setMsg(msgEl, ex?.message || "حدث خطأ أثناء الاستيراد", false);
    } finally {
      bulkFileInput.value = "";
    }
  });
}
