export function normalizeWhatsAppPhone(value) {
  const source = String(value ?? '')
    .trim()
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776));
  if (!/^[+\d\s().-]+$/.test(source)) throw new Error('أدخل رقم هاتف صحيحاً مع مفتاح الدولة.');
  let phone = source.replace(/[\s().-]/g, '');
  const international = phone.startsWith('+') || phone.startsWith('00');
  if (phone.startsWith('+')) phone = phone.slice(1);
  else if (phone.startsWith('00')) phone = phone.slice(2);
  if (!international && /^01[0125]\d{8}$/.test(phone)) phone = '20' + phone.slice(1);
  if (!/^[1-9]\d{7,14}$/.test(phone))
    throw new Error('أدخل الرقم الدولي مثل +86… أو 0086…، أو رقم موبايل مصري.');
  return phone;
}
export function orderMessage(name, lines, note = '') {
  const total = lines.reduce((n, l) => n + l.qty, 0);
  return [
    '*عدلة تكس | ADLATEX*',
    '*طلب تجريبي — DRAFT-001*',
    '',
    `أهلاً ${String(name).trim() || 'بك'}،`,
    'هذه تفاصيل الطلب للمراجعة:',
    '',
    ...lines.map(
      (l, i) => `${i + 1}. ${l.name}\nاللون: ${l.color} | كود: ${l.code}\nالكمية: ${l.qty} ثوب`,
    ),
    '',
    `*إجمالي الأثواب: ${total}*`,
    ...(note.trim() ? ['', `ملاحظات: ${note.trim()}`] : []),
    '',
    'يرجى مراجعة الأصناف والكميات وتأكيدها.',
    'شكراً لتعاملكم مع عدلة تكس.',
    '',
    '(رسالة تجريبية وليست طلباً فعلياً)',
  ].join('\n');
}
export function whatsappLink(phone, message) {
  if (!String(message).trim()) throw new Error('اكتب نص الرسالة أولاً.');
  return `https://wa.me/${normalizeWhatsAppPhone(phone)}?text=${encodeURIComponent(message)}`;
}
