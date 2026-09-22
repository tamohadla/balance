import {canManage} from './permissions.js?v=1';
import {requireAccess} from './auth-guard.js?v=permissions-1';
const member=(await requireAccess()).member;
import { escapeHtml, setMsg } from "./shared.js?v=224-1";
import { deleteBatch, listBatches } from "./import-review/batchService.js?v=3";

const msg = document.getElementById("msg");
const tbody = document.getElementById("tbody");

function statusBadge(s){
  if(s === "approved") return '<span class="badge ok">معتمد</span>';
  if(s === "partially_approved") return '<span class="badge warn">معتمد جزئيًا</span>';
  if(s === "cancelled") return '<span class="badge danger">ملغى</span>';
  return '<span class="badge">مسودة</span>';
}

async function load(){
  try{
    const rows = await listBatches();
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${escapeHtml(r.batch_no)}</td>
        <td>${r.batch_type==='purchase'?'مشتريات':'مبيعات'}</td>
        <td>${escapeHtml(r.source_file_name || "")}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${escapeHtml(r.created_at || "")}</td>
        <td>${escapeHtml(r.approved_at || "—")}</td>
        <td>${r.total_lines ?? 0}</td>
        <td>${r.approved_lines_count ?? 0}</td>
        <td>${r.pending_lines_count ?? 0}</td>
        <td>
          <div class="actionsRow">
            <a class="secondary smallBtn asBtn" href="./import-batch-details.html?batchId=${r.id}">عرض التفاصيل</a>
            <a class="secondary smallBtn asBtn" href="./${r.batch_type === "purchase" ? "purchases-import-review" : "sales-import-review"}.html?batchId=${r.id}">متابعة المراجعة</a>
            ${canManage(member,r.batch_type==='sale'?'sales':'purchases')?`<button class="danger smallBtn" data-id="${r.id}">حذف الحزمة</button>`:''}
          </div>
        </td>
      </tr>
    `).join("");
    setMsg(msg, `تم تحميل ${rows.length} حزمة`, true);
  }catch(err){ setMsg(msg, err.message || String(err), false); }
}

tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-id]");
  if(!btn) return;
  const id = btn.dataset.id;
  const ok = confirm("تأكيد شديد: سيتم حذف الحزمة وكل حركاتها الناتجة نهائياً ولا يمكن التراجع. متابعة؟");
  if(!ok) return;
  try{ await deleteBatch(id); await load(); }
  catch(err){ setMsg(msg, err.message || String(err), false); }
});

document.getElementById("btnReload")?.addEventListener("click", load);
load();
