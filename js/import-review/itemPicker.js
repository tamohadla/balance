import { escapeHtml, getPublicImageUrl, materialLabel, unitLabel } from "../shared.js";

export function createItemPicker({ items, onSelect }){
  const root = document.createElement("div");
  root.className = "comboRow";
  root.innerHTML = `
    <div class="itemPreview"><div class="ph">لا صورة</div></div>
    <div class="combo">
      <input class="comboInput" type="text" placeholder="ابحث عن مادة..." autocomplete="off" />
      <div class="comboPanel"></div>
      <small class="muted unitHint"></small>
    </div>
  `;

  const input = root.querySelector(".comboInput");
  const panel = root.querySelector(".comboPanel");
  const preview = root.querySelector(".itemPreview");
  const hint = root.querySelector(".unitHint");

  function filter(q){
    const s = String(q || "").trim().toLowerCase();
    if(!s) return items.slice(0, 80);
    return items.filter(r => `${materialLabel(r)} ${r.color_code} ${r.color_name || ""}`.toLowerCase().includes(s)).slice(0, 80);
  }

  function select(item){
    input.value = `${materialLabel(item)} | ${item.color_code} | ${item.color_name || ""}`.replace(/\s+\|\s+\|/g, " | ");
    hint.textContent = `وحدة الكمية الرئيسية: ${unitLabel(item.unit_type)}`;
    const url = getPublicImageUrl(item.image_path);
    preview.innerHTML = url ? `<img src="${url}" alt="item" />` : `<div class="ph">لا صورة</div>`;
    onSelect?.(item);
  }

  function render(){
    const list = filter(input.value);
    if(!list.length){ panel.innerHTML = '<div class="comboEmpty">لا نتائج</div>'; return; }
    panel.innerHTML = list.map(it => `
      <div class="comboItem" data-id="${it.id}">
        <div style="flex:1;min-width:0;">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(materialLabel(it))}</div>
          <div class="comboMeta">${escapeHtml(`${it.color_code} | ${it.color_name || ""} | ${unitLabel(it.unit_type)}`)}</div>
        </div>
      </div>
    `).join("");
  }

  input.addEventListener("focus", () => { panel.style.display = "block"; render(); });
  input.addEventListener("input", () => { panel.style.display = "block"; render(); });
  panel.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".comboItem");
    if(!itemEl) return;
    const it = items.find(x => x.id === itemEl.dataset.id);
    if(!it) return;
    select(it);
    panel.style.display = "none";
  });

  document.addEventListener("click", (e) => {
    if(!root.contains(e.target)) panel.style.display = "none";
  });

  return root;
}
