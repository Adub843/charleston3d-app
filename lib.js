// Pure helpers shared by the app and the build script, kept free of the DOM so they can be tested in Node.

export const PERSONALIZE_TAGS = ["customizable", "personalized", "personalised"];
export const REQUEST_TAG = "request-product";
// Quote placeholders ("Request a Quote" pages) can't be bought, so the shop leaves them out.
export const HIDDEN_TAGS = ["quote", "hidden", "app-hidden"];
export const REQUEST_HANDLES = ["custom-request", "custom-print-request", "free-custom-request", "request"];
export const PERSONALIZATION_MAX = 60;
export const MAX_FILE_MB = 20;
export const IMAGE_EXT = ["jpg", "jpeg", "png", "heic", "heif", "webp", "pdf"];
export const MODEL_EXT = ["stl", "3mf", "obj", "step", "stp"];

const tagsOf = (p) => (Array.isArray(p.tags) ? p.tags : String(p.tags ?? "").split(","))
  .map((t) => String(t).trim().toLowerCase()).filter(Boolean);
const cents = (v) => Math.round(Number(v) * 100);
const plain = (html, max) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim().slice(0, max);
const sized = (src, w) => (src ? `${src}${src.includes("?") ? "&" : "?"}width=${w}` : null);

// The $0 product that carries requests through checkout: tagged "request-product", or a known handle.
// It only counts when every variant is free, so a request can never charge the customer.
export function findRequestProduct(products) {
  const free = (p) => (p.variants ?? []).length > 0 && p.variants.every((v) => cents(v.price) === 0);
  const pick = products.find((p) => tagsOf(p).includes(REQUEST_TAG) && free(p))
    ?? products.find((p) => REQUEST_HANDLES.includes(p.handle) && free(p));
  if (!pick) return null;
  const v = pick.variants.find((x) => x.available !== false) ?? null;
  return v ? { productId: pick.id, handle: pick.handle, variantId: v.id } : null;
}

// Turns the store's public /products.json feed into the app catalog.
export function buildCatalog(products, store) {
  const request = findRequestProduct(products);
  const items = products
    .filter((p) => !request || p.id !== request.productId)
    .filter((p) => !tagsOf(p).some((t) => t === REQUEST_TAG || HIDDEN_TAGS.includes(t)))
    .map((p) => {
      const tags = tagsOf(p);
      const variants = (p.variants ?? []).map((v) => ({
        id: v.id,
        title: v.title === "Default Title" ? "" : String(v.title ?? ""),
        price: cents(v.price),
        compareAt: v.compare_at_price ? cents(v.compare_at_price) : null,
        available: v.available !== false,
        image: v.featured_image?.src ? sized(v.featured_image.src, 600) : null,
      }));
      return {
        id: p.id,
        handle: p.handle,
        title: String(p.title ?? ""),
        type: String(p.product_type ?? "").trim(),
        description: plain(p.body_html, 600),
        image: sized(p.images?.[0]?.src, 600),
        images: (p.images ?? []).slice(0, 6).map((i) => sized(i.src, 900)),
        customizable: tags.some((t) => PERSONALIZE_TAGS.includes(t)),
        options: (p.options ?? []).map((o) => o.name).filter((n) => n && n !== "Title"),
        variants,
      };
    })
    .filter((p) => p.variants.some((v) => v.price > 0) && p.variants.length);
  return { updated: new Date().toISOString(), store, request, products: items };
}

export const minPrice = (p) => Math.min(...p.variants.map((v) => v.price));
export const isAvailable = (p) => p.variants.some((v) => v.available);

// Form fields for one post to the store's /cart/add with several lines (items[n][...]).
export function cartFields(lines, source) {
  const out = [];
  lines.forEach((l, i) => {
    out.push([`items[${i}][id]`, String(l.variantId)]);
    out.push([`items[${i}][quantity]`, String(clampQty(l.qty))]);
    if (l.personalization) out.push([`items[${i}][properties][Personalization]`, l.personalization]);
    if (source) out.push([`items[${i}][properties][_Source]`, source]);
  });
  out.push(["return_to", "/cart"]);
  return out;
}

export const clampQty = (q) => Math.min(50, Math.max(1, Math.floor(Number(q)) || 1));

// One bag line per variant and personalization: the same item with a different name is its own line.
export function addLine(bag, line) {
  const key = `${line.variantId}|${line.personalization ?? ""}`;
  const next = bag.map((l) => ({ ...l }));
  const hit = next.find((l) => `${l.variantId}|${l.personalization ?? ""}` === key);
  if (hit) hit.qty = clampQty(hit.qty + line.qty);
  else next.push({ ...line, qty: clampQty(line.qty) });
  return next;
}

// Drops lines whose variant is gone or sold out, and refreshes titles and prices from the catalog.
export function reconcileBag(bag, products) {
  const byVariant = new Map();
  for (const p of products) for (const v of p.variants) byVariant.set(v.id, { p, v });
  return bag.flatMap((l) => {
    const hit = byVariant.get(l.variantId);
    if (!hit || !hit.v.available) return [];
    if (l.personalization && !hit.p.customizable) return [];
    return [{ ...l, title: hit.p.title, variantTitle: hit.v.title, price: hit.v.price, image: hit.v.image || hit.p.image, qty: clampQty(l.qty) }];
  });
}

export const bagTotal = (bag) => bag.reduce((n, l) => n + l.price * l.qty, 0);
export const bagCount = (bag) => bag.reduce((n, l) => n + l.qty, 0);

export function cleanPersonalization(s) {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, PERSONALIZATION_MAX);
}

// Checks one chosen file. Returns an error message, or "" when it's fine.
export function fileProblem(file, kind, maxMb = MAX_FILE_MB) {
  if (!file) return "";
  const ext = String(file.name ?? "").toLowerCase().split(".").pop();
  const allowed = kind === "model" ? MODEL_EXT : IMAGE_EXT;
  if (!allowed.includes(ext)) {
    return kind === "model" ? "Use an STL, 3MF, OBJ or STEP file." : "Use a JPG, PNG, HEIC, WebP or PDF file.";
  }
  if (!file.size) return "That file is empty.";
  if (file.size > maxMb * 1048576) return `That file is over ${maxMb} MB. Try a smaller one, or email it after you send the request.`;
  return "";
}

export const zipOk = (z) => !z || /^\d{5}(-\d{4})?$/.test(String(z).trim());

// Only letters, digits, dash and underscore from the ?src= QR tag, so it is safe to pass along.
export const cleanSource = (s) => String(s ?? "").replace(/[^\w-]/g, "").slice(0, 40);
