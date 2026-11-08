import { DEMO_TOKEN, demoOrder, totalRolls } from './order-demo-data.js';
const $ = (id) => document.getElementById(id);
const valid = new URLSearchParams(location.hash.slice(1)).get('demo') === DEMO_TOKEN;
$('invalid').hidden = valid;
$('order').hidden = !valid;
if (valid) {
  $('reference').textContent = demoOrder.reference;
  $('customer').textContent = demoOrder.customer;
  $('date').textContent = demoOrder.date;
  $('total').textContent = totalRolls();
  $('note').textContent = demoOrder.note;
  for (const line of demoOrder.lines) {
    const row = document.createElement('article');
    row.className = 'line';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'image-button';
    button.setAttribute('aria-label', `تكبير عينة ${line.name} ${line.color}`);
    const image = document.createElement('img');
    image.src = line.image;
    image.alt = `عينة لون ${line.color} توضيحية`;
    image.width = 88;
    image.height = 104;
    button.append(image);
    const description = document.createElement('div');
    description.className = 'description';
    const name = document.createElement('strong');
    name.textContent = line.name;
    const info = document.createElement('p');
    info.textContent = `${line.category} · ${line.color}`;
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = 'كود اللون ' + line.code;
    const hint = document.createElement('p');
    hint.className = 'image-hint';
    hint.textContent = 'اضغط على العينة لتكبيرها';
    description.append(name, info, code, hint);
    const quantity = document.createElement('div');
    quantity.className = 'qty';
    const number = document.createElement('strong');
    number.textContent = line.qty;
    const unit = document.createElement('small');
    unit.textContent = 'ثوب';
    quantity.append(number, unit);
    row.append(button, description, quantity);
    $('lines').append(row);
    button.onclick = () => {
      $('largePhoto').src = line.image;
      $('largePhoto').alt = image.alt;
      $('photoTitle').textContent = line.name + ' — ' + line.color;
      $('photo').showModal();
    };
  }
  $('copySummary').onclick = async () => {
    try {
      await navigator.clipboard.writeText(
        [
          `عدلة تكس — الطلب ${demoOrder.reference}`,
          ...demoOrder.lines.map((l) => `${l.name} / ${l.color} (${l.code}): ${l.qty} ثوب`),
          `الإجمالي: ${totalRolls()} ثوب`,
          'طلب تجريبي ببيانات وهمية',
        ].join('\n'),
      );
      $('feedback').textContent = 'تم نسخ ملخص الطلب.';
      $('feedback').dataset.error = 'false';
    } catch {
      $('feedback').textContent = 'تعذر النسخ؛ يمكنك استخدام الطباعة لحفظ التفاصيل.';
      $('feedback').dataset.error = 'true';
    }
  };
  $('print').onclick = () => window.print();
  $('closePhoto').onclick = () => $('photo').close();
}
