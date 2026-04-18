const BTN_ID = "btnScrollTop";
const SHOW_AFTER = 420;

function ensureButton(){
  let btn = document.getElementById(BTN_ID);
  if(btn) return btn;

  btn = document.createElement("button");
  btn.type = "button";
  btn.id = BTN_ID;
  btn.className = "scrollTopBtn";
  btn.setAttribute("aria-label", "العودة إلى الأعلى");
  btn.title = "العودة إلى الأعلى";
  btn.textContent = "↑";
  document.body.appendChild(btn);
  return btn;
}

function initScrollTop(){
  if(!document.body) return;
  const btn = ensureButton();
  if(!btn || btn.dataset.ready === "1") return;

  const toggle = () => {
    btn.classList.toggle("is-visible", window.scrollY > SHOW_AFTER);
  };

  window.addEventListener("scroll", toggle, { passive: true });
  btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  btn.dataset.ready = "1";
  toggle();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", initScrollTop, { once: true });
}else{
  initScrollTop();
}
