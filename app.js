// Charleston3D order app: shop the store's products, request items that aren't listed, and send custom
// print requests with photos or 3D files. Nothing is stored or charged here: every order and request is
// posted to the Charleston3D Shopify cart, and Shopify checkout takes payment and the customer's email.
import {
  addLine, bagCount, bagTotal, cartFields, clampQty, cleanPersonalization, cleanSource, fileProblem,
  isAvailable, minPrice, reconcileBag, zipOk, PERSONALIZATION_MAX,
} from "./lib.js";

const cfg = JSON.parse(document.querySelector("[data-config]").textContent);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: cfg.currency || "USD" });
const fmt = (c) => money.format(c / 100).replace(/\.00$/, "");
const source = cleanSource(new URLSearchParams(location.search).get("src"));
const BAG_KEY = "c3d-bag";

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
  return n;
};

let store = (cfg.storeUrl || "").replace(/\/+$/, "");
let products = [];
let request = null;
let bag = loadBag();
let filter = { q: "", type: "" };
let loadFailed = false;

// ---------- tabs ----------
const tabs = $$("[data-tab]");
function show(name, focus) {
  // Old links (#find, #custom) open the request page with that choice ticked.
  const kind = $(`[data-kind="${name}"]`);
  if (kind) { kind.checked = true; name = "request"; }
  if (!["shop", "request"].includes(name)) name = "shop";
  for (const t of tabs) {
    const on = t.dataset.tab === name;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  }
  for (const p of $$("[data-panel]")) p.hidden = p.dataset.panel !== name;
  if (location.hash !== `#${name}`) history.replaceState(null, "", `${location.search}#${name}`);
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => show(t.dataset.tab));
  t.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (d) { e.preventDefault(); show(tabs[(i + d + tabs.length) % tabs.length].dataset.tab, true); }
  });
});
$$("[data-go]").forEach((b) => b.addEventListener("click", () => { show(b.dataset.go); scrollTo({ top: $(".tabs").offsetTop - 8, behavior: "smooth" }); }));
addEventListener("hashchange", () => show(location.hash.slice(1)));
show(location.hash.slice(1));

// ---------- catalog ----------
async function loadCatalog() {
  try {
    const res = await fetch(cfg.catalogUrl, { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    const cat = await res.json();
    products = cat.products ?? [];
    request = cat.request ?? null;
    if (cat.store) store = cat.store.replace(/\/+$/, "");
  } catch (e) {
    console.error(e);
    loadFailed = true;
    $("[data-shop-note]").textContent = "The shop couldn't load. Please refresh, or visit charleston3d.com.";
  }
  bag = reconcileBag(bag, products);
  saveBag();
  drawTypes();
  drawGrid();
  setupRequests();
}

function drawTypes() {
  const types = [...new Set(products.map((p) => p.type).filter(Boolean))].sort();
  const box = $("[data-types]");
  box.replaceChildren();
  if (types.length < 2) return;
  for (const t of ["", ...types]) {
    box.append(h("button", {
      type: "button", class: "chip", "aria-pressed": String(filter.type === t),
      onclick: () => { filter.type = t; drawTypes(); drawGrid(); },
    }, t || "All"));
  }
}

function drawGrid() {
  const grid = $("[data-grid]");
  const q = filter.q.trim().toLowerCase();
  const list = products
    .filter((p) => !filter.type || p.type === filter.type)
    .filter((p) => !q || `${p.title} ${p.type} ${p.description}`.toLowerCase().includes(q))
    .sort((a, b) => Number(isAvailable(b)) - Number(isAvailable(a)));
  grid.replaceChildren(...list.map((p) => h("li", {},
    h("button", { type: "button", class: "tile", onclick: () => openProduct(p), "aria-label": `${p.title}, ${fmt(minPrice(p))}${isAvailable(p) ? "" : ", sold out"}` },
      h("span", { class: "tile-img" }, p.image ? h("img", { src: p.image, alt: "", loading: "lazy", width: "600", height: "600" }) : h("span", { class: "noimg" }, "3D")),
      p.customizable ? h("span", { class: "badge" }, "Personalize") : null,
      !isAvailable(p) ? h("span", { class: "badge out" }, "Sold out") : null,
      h("span", { class: "tile-title" }, p.title),
      h("span", { class: "tile-price" }, p.variants.length > 1 && new Set(p.variants.map((v) => v.price)).size > 1 ? `from ${fmt(minPrice(p))}` : fmt(minPrice(p)))))));
  const note = $("[data-shop-note]");
  // With nothing to browse, the search box goes away and the request card becomes the empty state.
  const empty = !products.length;
  $(".shop-tools").hidden = empty;
  grid.hidden = !list.length;
  if (loadFailed) return;
  if (empty) {
    note.textContent = "";
    $("[data-nudge-title]").textContent = "New pieces are on the way";
    $("[data-nudge-text]").textContent = "The shop is being restocked. Tell us what you're after, or send your own idea, and we'll quote it for free.";
  } else note.textContent = list.length ? "" : "Nothing matches that. Try another word, or request it below.";
}
$("[data-search]").addEventListener("input", (e) => { filter.q = e.target.value; drawGrid(); });

// ---------- product sheet ----------
const pdDialog = $("[data-product]");
let addCurrent = null;
// Enter in the name or quantity field adds to the bag instead of closing the sheet.
$("[data-product-form]").addEventListener("submit", (e) => e.preventDefault());
$("[data-product-form]").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
  e.preventDefault();
  if (addCurrent && !$("[data-pd] .btn.brass").disabled) addCurrent();
});
$("[data-close]").addEventListener("click", () => pdDialog.close());
// A tap on the dimmed backdrop closes either sheet.
for (const d of $$("dialog.sheet")) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
function openProduct(p) {
  let v = p.variants.find((x) => x.available) ?? p.variants[0];
  let img = 0;
  const box = $("[data-pd]");
  const status = h("p", { class: "status", role: "status", "aria-live": "polite" });
  const priceEl = h("p", { class: "pd-price" });
  const mainImg = h("img", { alt: p.title, width: "900", height: "900" });
  const qty = h("input", { type: "number", min: "1", max: "50", value: "1", inputmode: "numeric", id: "pd-qty", class: "qty" });
  const pers = p.customizable ? h("input", {
    id: "pd-pers", type: "text", maxlength: String(PERSONALIZATION_MAX), autocomplete: "off", required: true,
    placeholder: "Exactly as it should be printed", "aria-describedby": "pd-pers-hint pd-pers-err",
  }) : null;
  const persErr = h("p", { class: "err", id: "pd-pers-err", hidden: true });
  const addBtn = h("button", { type: "button", class: "btn brass full", onclick: add });

  const sync = () => {
    priceEl.replaceChildren(h("span", {}, fmt(v.price)));
    if (v.compareAt > v.price) priceEl.append(h("s", { class: "muted" }, fmt(v.compareAt)));
    addBtn.disabled = !v.available;
    addBtn.textContent = v.available ? "Add to bag" : "Sold out";
    const src = v.image || p.images[img] || p.image;
    if (src) mainImg.src = src;
    mainImg.hidden = !src;
  };

  const variantPick = p.variants.length > 1 ? h("label", { class: "field" }, p.options.join(" / ") || "Option",
    h("select", { onchange: (e) => { v = p.variants.find((x) => String(x.id) === e.target.value); sync(); } },
      p.variants.map((x) => h("option", { value: String(x.id), selected: x === v, disabled: !x.available },
        `${x.title} · ${fmt(x.price)}${x.available ? "" : " (sold out)"}`)))) : null;

  const thumbs = p.images.length > 1 ? h("div", { class: "thumbs" }, p.images.map((src, i) =>
    h("button", { type: "button", "aria-label": `Photo ${i + 1}`, onclick: () => { img = i; v = { ...v, image: null }; mainImg.src = src; } },
      h("img", { src, alt: "", loading: "lazy", width: "80", height: "80" })))) : null;

  function add() {
    persErr.hidden = true;
    pers?.removeAttribute("aria-invalid");
    const text = pers ? cleanPersonalization(pers.value) : "";
    if (pers && !text) {
      persErr.textContent = "Type the name or text to print.";
      persErr.hidden = false;
      pers.setAttribute("aria-invalid", "true");
      pers.focus();
      return;
    }
    const real = p.variants.find((x) => x.id === v.id);
    bag = addLine(bag, {
      variantId: real.id, qty: clampQty(qty.value), personalization: text,
      title: p.title, variantTitle: real.title, price: real.price, image: real.image || p.image,
    });
    saveBag();
    status.textContent = "Added to your bag.";
    addBtn.textContent = "Added";
    setTimeout(() => { pdDialog.close(); openBag(); }, 350);
  }

  addCurrent = add;
  box.replaceChildren(
    h("div", { class: "pd-media" }, mainImg, thumbs),
    h("div", { class: "pd-info" },
      h("h2", { id: "pd-title" }, p.title),
      priceEl,
      p.description ? h("p", { class: "pd-desc" }, p.description) : null,
      variantPick,
      pers ? h("div", { class: "field" },
        h("label", { for: "pd-pers" }, "Name to print"), pers,
        h("span", { class: "hint", id: "pd-pers-hint" }, "We print it exactly as typed and check every spelling before printing."),
        persErr) : null,
      h("div", { class: "field" }, h("label", { for: "pd-qty" }, "Quantity"), qty),
      addBtn,
      status,
      h("p", { class: "small" }, "Want it changed? ",
        h("button", { type: "button", class: "linkish", onclick: () => customize(p) }, "Ask for a custom version")),
    ),
  );
  sync();
  pdDialog.showModal();
}

function customize(p) {
  pdDialog.close();
  show("custom");
  const ta = $("[data-prefill]");
  if (!ta.value.trim()) ta.value = `Based on "${p.title}" from your shop, but `;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

// ---------- bag ----------
function loadBag() {
  try { const b = JSON.parse(localStorage.getItem(BAG_KEY) ?? "[]"); return Array.isArray(b) ? b : []; } catch { return []; }
}
function saveBag() {
  try { localStorage.setItem(BAG_KEY, JSON.stringify(bag)); } catch { /* private mode: the bag lasts for this visit */ }
  const n = bagCount(bag), c = $("[data-bag-count]");
  c.textContent = String(n);
  c.hidden = !n;
  $("[data-open-bag]").setAttribute("aria-label", `Bag, ${n} item${n === 1 ? "" : "s"}`);
}

const bagDialog = $("[data-bag]");
function openBag() { drawBag(); bagDialog.showModal(); }
$("[data-open-bag]").addEventListener("click", openBag);

function drawBag() {
  const body = $("[data-bag-body]");
  if (!bag.length) {
    body.replaceChildren(h("p", { class: "muted" }, "Your bag is empty."),
      h("button", { type: "button", class: "btn", onclick: () => { bagDialog.close(); show("shop"); } }, "Browse the shop"));
    return;
  }
  const setQty = (i, q) => { bag[i].qty = clampQty(q); saveBag(); drawBag(); };
  body.replaceChildren(
    h("ul", { class: "lines", role: "list" }, bag.map((l, i) => h("li", { class: "line" },
      l.image ? h("img", { src: l.image, alt: "", width: "64", height: "64" }) : h("span", { class: "noimg sm" }, "3D"),
      h("div", { class: "line-info" },
        h("strong", {}, l.title),
        l.variantTitle ? h("span", { class: "muted small" }, l.variantTitle) : null,
        l.personalization ? h("span", { class: "small" }, `Name to print: ${l.personalization}`) : null,
        h("span", { class: "small" }, fmt(l.price * l.qty))),
      h("div", { class: "stepper" },
        h("button", { type: "button", "aria-label": `One less ${l.title}`, onclick: () => (l.qty > 1 ? setQty(i, l.qty - 1) : remove(i)) }, "−"),
        h("span", { "aria-live": "polite" }, String(l.qty)),
        h("button", { type: "button", "aria-label": `One more ${l.title}`, onclick: () => setQty(i, l.qty + 1) }, "+")),
      h("button", { type: "button", class: "linkish danger", onclick: () => remove(i) }, "Remove")))),
    h("p", { class: "total" }, h("span", {}, "Subtotal"), h("strong", {}, fmt(bagTotal(bag)))),
    h("p", { class: "muted small" }, "Shipping and tax are added at checkout."),
    h("button", { type: "button", class: "btn brass full", onclick: checkout }, "Check out securely"),
    h("p", { class: "muted small center" }, "You'll finish on charleston3d.com, powered by Shopify."),
  );
  function remove(i) { bag.splice(i, 1); saveBag(); drawBag(); }
}

// Posts every bag line to the store's cart in one form submit, then the store shows its cart page.
function checkout() {
  const lines = reconcileBag(bag, products);
  if (!lines.length) { bag = []; saveBag(); drawBag(); return; }
  const form = h("form", { method: "post", action: `${store}/cart/add`, hidden: true });
  for (const [name, value] of cartFields(lines, source)) form.append(h("input", { type: "hidden", name, value }));
  document.body.append(form);
  bag = []; saveBag();
  form.submit();
}

// ---------- request forms ----------
function setupRequests() {
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  for (const form of $$("form[data-req]")) {
    $$("[data-date]", form).forEach((d) => { d.min = today; });
    $("[data-src]", form).value = source;
    if (!request) {
      // No free request product on the store yet: send people to email instead of a form that can't post.
      form.replaceChildren(
        h("h2", {}, "Request something, free"),
        h("p", {}, "Requests are free. Email us what you have in mind, with any photos or 3D files, and we'll reply with a quote within 1-2 business days."),
        h("a", { class: "btn brass full", href: `mailto:${cfg.email}?subject=${encodeURIComponent("Charleston3D request")}` }, "Email your request"),
        h("p", { class: "muted small center" }, "Or use the form at ", h("a", { href: `${store}${cfg.customPage}` }, "charleston3d.com")),
      );
      continue;
    }
    form.action = `${store}/cart/add`;
    $("[data-req-variant]", form).value = String(request.variantId);
    $$("[data-file]", form).forEach((inp) => inp.addEventListener("change", () => check(inp)));
    // Once a field has been flagged, re-check it as they type so the message clears when it's fixed.
    form.addEventListener("input", (e) => {
      if (e.target.getAttribute("aria-invalid") !== "true") return;
      check(e.target);
      if (!form.querySelector("[aria-invalid=true]")) $("[data-status]", form).textContent = ""; $("[data-status]", form).classList.remove("bad");
    });
    form.addEventListener("submit", (e) => {
      const bad = $$("textarea, input", form).filter((el) => !check(el));
      if (bad.length) {
        e.preventDefault();
        bad[0].focus();
        $("[data-status]", form).textContent = "Please fix the highlighted field."; $("[data-status]", form).classList.add("bad");
        return;
      }
      // Drop empty file inputs so Shopify doesn't record blank file properties.
      $$("[data-file]", form).forEach((inp) => { if (!inp.files.length) inp.disabled = true; });
      const src = $("[data-src]", form); if (!src.value) src.disabled = true;
      $$("input:not([type=hidden]):not([type=file])", form).forEach((inp) => { if (!inp.value.trim()) inp.disabled = true; });
      const btn = $("button[type=submit]", form);
      btn.disabled = true;
      btn.textContent = $$("[data-file]", form).some((i) => i.files.length) ? "Uploading your files…" : "Sending your request…";
      $("[data-status]", form).textContent = "Taking you to the cart…"; $("[data-status]", form).classList.remove("bad");
      setTimeout(() => { // if the store is slow or the page comes back from history, let them try again
        btn.disabled = false; btn.textContent = "Send my free request";
        $$("input[disabled], textarea[disabled]", form).forEach((x) => { x.disabled = false; });
      }, 20000);
    });
  }
}
addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  $$("form[data-req] [disabled]").forEach((x) => { x.disabled = false; });
  $$("form[data-req] button[type=submit]").forEach((b) => { b.textContent = "Send my free request"; });
  bag = loadBag(); saveBag();
});

// Validates one field; shows or clears its message. Returns true when it's fine.
function check(el) {
  const wrap = el.closest(".field");
  const err = wrap && $("[data-err]", wrap);
  if (!err) return true;
  let msg = "";
  const v = el.value.trim();
  if (el.dataset.file) msg = fileProblem(el.files[0], el.dataset.file, cfg.maxFileMb);
  else if (el.required && !v) msg = "Please fill this in.";
  else if (el.dataset.zip !== undefined && !zipOk(v)) msg = "Use a 5-digit US ZIP code.";
  else if (el.type === "url" && v && !/^https?:\/\/\S+\.\S+/.test(v)) msg = "Paste a full link starting with https://";
  else if (el.type === "number" && v && !(Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 10000)) msg = "Use a whole number from 1 to 10,000.";
  else if (el.dataset.date !== undefined && v && el.min && v < el.min) msg = "Pick today or a later date.";
  err.textContent = msg;
  err.hidden = !msg;
  if (msg) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
  return !msg;
}

saveBag();
loadCatalog();
