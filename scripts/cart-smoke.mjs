// Live check that the store accepts the app's cart post: several lines in one items[n][...] form,
// with a personalization property. Uses /cart/add.js (same form parser, answers in JSON) and a
// fresh cookie-less session, so nothing touches a real customer's cart. Exits non-zero on failure.
// Usage: node scripts/cart-smoke.mjs https://charleston3d.com
import { readFileSync } from "node:fs";
import { cartFields } from "../lib.js";

const store = (process.argv[2] || "").replace(/\/+$/, "");
const cat = JSON.parse(readFileSync(new URL("../catalog.json", import.meta.url), "utf8"));
const pick = cat.products.flatMap((p) => p.variants.filter((v) => v.available).map((v) => ({ p, v }))).slice(0, 2);
if (!pick.length) { console.log("No products for sale yet; cart check skipped."); process.exit(0); }

const lines = pick.map(({ p, v }) => ({ variantId: v.id, qty: 1, personalization: p.customizable ? "Smoke Test" : "" }));
const body = new URLSearchParams(cartFields(lines, "smoke-test").filter(([k]) => k !== "return_to"));
const res = await fetch(`${store}/cart/add.js`, { method: "POST", body, headers: { accept: "application/json" } });
const out = await res.json().catch(() => ({}));
if (!res.ok || (out.items ?? []).length !== lines.length) {
  console.error(`Cart check failed (${res.status}):`, JSON.stringify(out).slice(0, 400));
  process.exit(1);
}
console.log(`Cart check passed: ${out.items.length} lines added in one post.`);
