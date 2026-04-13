import { escapeHtml, formatItemFullLabel, setMsg } from "./shared.js";
import { loadBatch } from "./import-review/batchService.js";

const msg = document.getElementById("msg");
const tbody = document.getElementById("tbody");
const meta = document.getElementById("meta");

async function init(){
  const batchId = new URL(location.href).searchParams.get("batchId");
  if(!batchId) return setMsg(msg, "batchId مفقود", false);

  try{
    const out = await loadBatch(batchId);
    const batch = out.batch;
    meta.innerHTML = `
      <strong>${escapeHtml(batch.batch_no)}</strong> |
      النوع: ${escapeHtml(batch.batch_type)} |
      الحالة: ${escapeHtml(batch.status)} |
      الملف: ${escapeHtml(batch.source_file_name || "")}
    `;

    tbody.innerHTML = out.lines.map(line => `
      <tr>
        <td>${line.row_index}</td>
        <td>${escapeHtml(line.raw_item_name || "")}</td>
        <td>${escapeHtml(line.raw_color_code || "")}</td>
        <td>${line.raw_qty_primary ?? ""}</td>
        <td>${line.raw_rolls ?? ""}</td>
        <td>${escapeHtml(line.raw_date || "")}</td>
        <td>${escapeHtml(line.match_status)}</td>
        <td>${line.matched_item ? escapeHtml(formatItemFullLabel(line.matched_item)) : "—"}</td>
        <td>${line.is_posted ? "نعم" : "لا"}</td>
      </tr>
    `).join("");

    const reviewPage = batch.batch_type === "purchase" ? "purchases-import-review.html" : "sales-import-review.html";
    document.getElementById("btnContinue").setAttribute("href", `./${reviewPage}?batchId=${batch.id}`);

    setMsg(msg, `تم تحميل ${out.lines.length} بند`, true);
  }catch(err){ setMsg(msg, err.message || String(err), false); }
}

init();
