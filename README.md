# Inventory Web App (No Auth) — GitHub Pages + Supabase

هذا إصدار MVP "بدون تسجيل دخول" (لا Auth / لا حماية حاليا).

## الصفحات
- index.html : صفحة البداية
- items.html : تعريف المواد + صورة اختيارية
- purchases.html : مشتريات (وارد)
- sales.html : مبيعات (صادر) — يسمح برصيد سالب
- inventory.html : متابعة المخزون + مؤشر ركود (آخر مبيعات فقط) + ترتيبات
- reconciliation.html : تسوية جرد شهرية (إدخال فعلي مرة بالشهر)
- adjustments.html : سجل جلسات التسوية وتفاصيلها

## الإعداد السريع
1) أنشئ مشروع Supabase.
2) نفّذ: `sql/schema_noauth.sql` داخل SQL Editor.
3) في Storage أنشئ bucket باسم: `item-images`
   - اجعله Public.
   - ملاحظة: الرفع من الويب عبر anon key يحتاج سياسات Storage تسمح بالرفع (حسب إعدادات مشروعك).
4) افتح `js/supabaseClient.js` وضع:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
5) ارفع مجلد المشروع على GitHub Pages وافتح `index.html`.

## ملاحظات مهمة
- هذا الإصدار متعمد أنه "مفتوح" للتجربة. لا تستخدمه على بيانات حساسة.
- لاحقاً عند تفعيل الحماية سنضيف Auth + RLS policies ونقفل كل شيء.
