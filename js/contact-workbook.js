import { normalizeMatchToken } from './core/text-utils.js';

export const contactColumns = {
  customers: [
    ['name', ['اسم الزبون', 'اسم العميل', 'الاسم'], 150],
    ['brand_name', ['اسم المصنع أو البراند', 'المصنع أو البراند', 'اسم المصنع', 'البراند'], 150],
    ['phone', ['رقم الموبايل', 'رقم الهاتف', 'الموبايل', 'الهاتف'], 40],
    ['address', ['المكان (العنوان)', 'العنوان', 'المكان'], 250],
    ['customer_category', ['التصنيف']],
  ],
  suppliers: [
    ['name', ['اسم المورد', 'الاسم'], 150],
    ['phone', ['رقم الهاتف', 'رقم الموبايل', 'الهاتف', 'الموبايل'], 40],
    ['address', ['العنوان', 'المكان', 'المكان (العنوان)'], 250],
    ['notes', ['الملاحظات', 'ملاحظات'], 1000],
  ],
};

export function parseContacts(rows, kind) {
  const columns = contactColumns[kind];
  const headers = (rows[0] || []).map(normalizeMatchToken);
  const indices = columns.map(([field, aliases]) => {
    const labels = [field, ...aliases].map(normalizeMatchToken);
    const matches = headers.flatMap((header, index) => (labels.includes(header) ? [index] : []));
    if (matches.length > 1) throw new Error(`العمود «${aliases[0]}» مكرر.`);
    return matches[0];
  });
  if (indices[0] === undefined) throw new Error(`أضف عمود «${columns[0][1][0]}» في الصف الأول.`);
  const entries = [];
  const errors = [];
  for (const [index, row] of rows.slice(1).entries()) {
    if (!row?.some((value) => String(value ?? '').trim())) continue;
    const entry = { kind };
    const issues = [];
    for (const [i, [field, [label], max]] of columns.entries()) {
      const value = String(row[indices[i]] ?? '').trim();
      if (field === 'name' && !value) issues.push('الاسم مطلوب');
      if (max && Array.from(value).length > max) issues.push(`${label} يتجاوز ${max} حرفًا`);
      if (field === 'customer_category') {
        const category = normalizeMatchToken(value);
        if (['', 'عملاء', 'regular'].includes(category)) entry[field] = 'regular';
        else if (['كبار عملاء', 'vip'].includes(category)) entry[field] = 'vip';
        else issues.push('التصنيف يجب أن يكون عملاء أو كبار عملاء');
      } else {
        entry[field] = value;
      }
    }
    if (issues.length) errors.push(`الصف ${index + 2}: ${issues.join('، ')}`);
    else entries.push(entry);
  }
  return { entries, errors };
}
