import { normalizeWhatsAppPhone, orderMessage, whatsappLink } from './whatsapp-order-model.js';
const $ = (id) => document.getElementById(id);
const sample = [
  { name: 'ريب فليس', color: 'زيتي', code: '10', qty: 12, swatch: '#747954' },
  { name: 'ريب فليس', color: 'مينت', code: '20', qty: 6, swatch: '#9bbeb0' },
  { name: 'ميلتون', color: 'كريمي', code: '03', qty: 4, swatch: '#e5dcc5' },
];
for (const [index, line] of sample.entries()) {
  const row = document.createElement('div');
  row.className = 'line';
  const swatch = document.createElement('div');
  swatch.className = 'swatch';
  swatch.style.setProperty('--swatch', line.swatch);
  swatch.setAttribute('aria-hidden', 'true');
  const description = document.createElement('div');
  description.className = 'description';
  const title = document.createElement('strong');
  title.textContent = line.name;
  const detail = document.createElement('small');
  detail.textContent = `${line.color} · كود ${line.code}`;
  description.append(title, detail);
  const qty = document.createElement('label');
  qty.className = 'quantity';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.max = '9999';
  input.step = '1';
  input.value = line.qty;
  input.setAttribute('aria-label', `عدد أثواب ${line.name} ${line.color}`);
  input.dataset.line = index;
  const unit = document.createElement('span');
  unit.textContent = 'ثوب';
  qty.append(input, unit);
  row.append(swatch, description, qty);
  $('lines').append(row);
  input.addEventListener('input', () => {
    line.qty = Number(input.value);
    $('total').textContent = sample.reduce(
      (sum, l) => sum + (Number.isFinite(l.qty) ? l.qty : 0),
      0,
    );
  });
}
function feedback(text, error = false) {
  $('feedback').textContent = text;
  $('feedback').dataset.error = String(error);
}
function regenerate() {
  $('message').value = orderMessage($('customer').value, sample, $('note').value);
  feedback('');
}
function recipient() {
  try {
    $('recipient').textContent = '+' + normalizeWhatsAppPhone($('phone').value);
  } catch {
    $('recipient').textContent = '';
  }
}
// Recipient is supplied in the URL fragment, never embedded in this public demo or stored.
const supplied = new URLSearchParams(location.hash.slice(1)).get('phone');
if (supplied) {
  $('phone').value = supplied.slice(0, 40);
  recipient();
  history.replaceState(null, '', location.pathname + location.search);
}
$('prepare').onclick = () => {
  const invalid = [...document.querySelectorAll('[data-line]')].find(
    (i) => !i.value || !i.checkValidity(),
  );
  if (invalid) {
    $('orderError').hidden = false;
    $('orderError').dataset.error = 'true';
    $('orderError').textContent = 'أدخل عدداً صحيحاً من 1 إلى 9999 لكل صنف.';
    invalid.focus();
    return;
  }
  $('orderError').hidden = true;
  regenerate();
  $('compose').showModal();
};
$('close').onclick = () => $('compose').close();
$('phone').addEventListener('input', () => {
  recipient();
  feedback('');
});
$('rebuild').onclick = regenerate;
$('copy').onclick = async () => {
  try {
    if (!$('message').value.trim()) return feedback('اكتب نص الرسالة أولاً.', true);
    await navigator.clipboard.writeText($('message').value);
    feedback('تم نسخ الرسالة.');
  } catch {
    feedback('تعذّر النسخ التلقائي؛ حدّد النص وانسخه يدوياً.', true);
    $('message').focus();
    $('message').select();
  }
};
$('sendForm').onsubmit = (e) => {
  e.preventDefault();
  try {
    const link = whatsappLink($('phone').value, $('message').value);
    const a = document.createElement('a');
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.append(a);
    a.click();
    a.remove();
    feedback('تم طلب فتح واتساب. راجع المحادثة واضغط إرسال بنفسك.');
  } catch (error) {
    feedback(error.message, true);
    $('phone').focus();
  }
};
