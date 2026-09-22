import { supabase } from "./supabaseClient.js?v=permissions-1";
import { requireAccess } from "./auth-guard.js?v=permissions-1";
import { allRows } from "./stock-entries.js";
import { readStock } from "./inventory-data.js";
import { stockMatches, stockTotals } from "./inventory-model.js";
import { escapeHtml as esc, todayISO } from "./shared.js?v=224-1";
const $ = (id) => document.getElementById(id),
  access = await requireAccess();
$("welcome").textContent =
  `أهلًا ${access.member.display_name || ""}، هذه نظرة على العمل`;
if (access.member.role !== "admin")
  document.querySelectorAll("[data-admin]").forEach((n) => (n.hidden = true));
const number = (n) =>
  Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
function metric(label, value, detail, href, style = "") {
  return `<a class="metric ${style}" href="${href}"><span>${esc(label)}</span><strong>${number(value)}</strong><small>${esc(detail)} <b aria-hidden="true">←</b></small></a>`;
}
function row(label, value, detail, href, style = "") {
  return `<a class="dashboard-row ${style}" href="${href}"><div><strong>${esc(label)}</strong><small>${esc(detail)}</small></div><span>${number(value)} <b aria-hidden="true">←</b></span></a>`;
}
function failed(id) {
  $(id).innerHTML =
    '<p class="load-error">تعذر تحميل هذا الملخص. اضغط «تحديث البيانات» لإعادة المحاولة.</p>';
}
let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  $("refreshDashboard").disabled = true;
  $("updatedAt").textContent = "جارٍ تحديث البيانات…";
  const [stock, orders, entries, imports, recon] = await Promise.allSettled([
    readStock(),
    allRows(() =>
      supabase.from("customer_orders").select("id,status").order("id"),
    ),
    allRows(() =>
      supabase
        .from("stock_entry_groups")
        .select(
          "id,type,source,source_file_name,note,created_at,created_by_name,stock_moves!inner(id)",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id"),
    ),
    allRows(() =>
      supabase.from("import_batches").select("id,status").order("id"),
    ),
    allRows(() => supabase.from("recon_sessions").select("id").order("id")),
  ]);
  let other = "";
  if (stock.status === "fulfilled") {
    const data = stock.value,
      active = data.rows.filter((r) => r.is_active),
      t = stockTotals(active);
    $("stockOverview").innerHTML =
      metric(
        "خامات وألوان نشطة",
        t.items,
        "عرض المواد وأرصدتها",
        "inventory.html",
      ) +
      metric(
        "رصيد الأثواب",
        t.rolls,
        "إجمالي الرصيد الفعلي",
        "inventory.html",
      ) +
      metric(
        "رصيد بالكيلو",
        t.kg,
        "كغ · بدون جمع الوحدات المختلفة",
        "inventory.html?unit=kg",
      ) +
      metric(
        "رصيد بالمتر",
        t.m,
        "متر · بدون جمع الوحدات المختلفة",
        "inventory.html?unit=m",
      );
    $("stockAlerts").innerHTML = [
      [
        "shortage",
        "عجز عن الطلبات",
        "مواد لا يغطي رصيدها الطلبات القائمة",
        "attention",
      ],
      ["negative", "رصيد سالب", "رصيد أثواب أو كمية رئيسية سالب", "attention"],
      ["zero_rolls", "نفاد الأثواب", "رصيد الأثواب يساوي صفرًا", ""],
      ["low_stock", "رصيد منخفض", "أكثر من صفر وأقل من 10 أثواب", ""],
    ]
      .map(([filter, label, detail, style]) =>
        row(
          label,
          active.filter((r) => stockMatches(r, filter, 10)).length,
          detail,
          `inventory.html?filter=${filter}&threshold=10`,
          style,
        ),
      )
      .join("");
    other +=
      metric(
        "دليل المواد",
        data.items.length,
        "النشطة وغير النشطة",
        "items.html?status=all",
      ) +
      metric(
        "مواد غير نشطة",
        data.items.filter((i) => !i.is_active).length,
        "مراجعة المواد الموقوفة",
        "items.html?status=inactive",
      );
  } else {
    failed("stockOverview");
    failed("stockAlerts");
    other += '<div class="load-error">تعذر تحميل ملخص المواد.</div>';
  }
  if (orders.status === "fulfilled") {
    const rows = orders.value;
    $("orderOverview").innerHTML =
      [
        ["draft", "طلبات مسودة", "تحتاج مراجعة أو تأكيد"],
        ["confirmed", "طلبات مؤكدة", "تحتاج متابعة التنفيذ"],
        [
          "executed",
          "محوّلة إلى المبيعات",
          "راجع سجل المبيعات للتحقق من حفظ الكميات",
        ],
      ]
        .map(([status, label, detail]) =>
          row(
            label,
            rows.filter((o) => (o.status || "draft") === status).length,
            detail,
            `orders.html?status=${status}`,
          ),
        )
        .join("") +
      row("كل الطلبات", rows.length, "فتح سجل الطلبات الكامل", "orders.html");
  } else failed("orderOverview");
  if (entries.status === "fulfilled") {
    const today = todayISO(),
      all = entries.value;
    const localDay = (ts) => {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    $("entryOverview").innerHTML = ["sale", "purchase"]
      .map((type) =>
        metric(
          type === "sale" ? "مجموعات مبيعات اليوم" : "مجموعات مشتريات اليوم",
          all.filter((g) => g.type === type && localDay(g.created_at) === today)
            .length,
          "حسب تاريخ الإدخال الفعلي",
          `${type === "sale" ? "sales" : "purchases"}-review.html?from=${today}&to=${today}`,
        ),
      )
      .join("");
    $("recentEntries").innerHTML =
      all
        .slice(0, 6)
        .map(
          (g) =>
            `<a class="dashboard-row" href="${g.type === "sale" ? "sales" : "purchases"}-review.html?group=${g.id}"><div><span class="entry-type ${g.type}">${g.type === "sale" ? "مبيعات" : "مشتريات"}</span><strong>${esc(g.note || g.source_file_name || `مجموعة ${g.id.slice(0, 8).toUpperCase()}`)}</strong><small>${esc(g.created_by_name || "بيانات قديمة · الموظف غير مسجل")}</small></div><span class="entry-time">${esc(new Date(g.created_at).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }))} ←</span></a>`,
        )
        .join("") || '<p class="loading">لا توجد مجموعات مسجلة بعد.</p>';
  } else {
    failed("entryOverview");
    failed("recentEntries");
  }
  if (imports.status === "fulfilled")
    other += metric(
      "حزم الاستيراد",
      imports.value.length,
      `${imports.value.filter((b) => ["draft", "partially_approved"].includes(b.status)).length} حزمة لم يكتمل اعتمادها`,
      "import-batches.html",
    );
  else other += '<div class="load-error">تعذر تحميل ملخص الاستيراد.</div>';
  if (recon.status === "fulfilled")
    other += metric(
      "جلسات التسوية",
      recon.value.length,
      "تفاصيل الفعلي والفروق المسجلة",
      "adjustments.html",
    );
  else other += '<div class="load-error">تعذر تحميل ملخص التسويات.</div>';
  $("otherOverview").innerHTML = other;
  const incomplete = [stock, orders, entries, imports, recon].some(
    (r) => r.status === "rejected",
  );
  $("updatedAt").textContent =
    (incomplete ? "تحديث جزئي — " : "آخر تحديث: ") +
    new Date().toLocaleTimeString("ar-EG");
  $("refreshDashboard").disabled = false;
  loading = false;
}
$("refreshDashboard").onclick = load;
await load();
