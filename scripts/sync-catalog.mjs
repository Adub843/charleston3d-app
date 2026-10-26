// Builds catalog.json from the Charleston3D store's public product feed. No token needed:
// /products.json lists every product published to the Online Store.
// Usage: node scripts/sync-catalog.mjs https://charleston3d.com
import { writeFileSync } from "node:fs";
import { buildCatalog } from "../lib.js";

const store = (process.argv[2] || process.env.STORE_URL || "").replace(/\/+$/, "");
if (!store) { console.error("Give the store address, e.g. https://charleston3d.com"); process.exit(1); }

const products = [];
let origin = store;
for (let page = 1; page < 40; page++) {
  const res = await fetch(`${store}/products.json?limit=250&page=${page}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Store answered ${res.status} for /products.json`);
  // Cart posts must go to the store's primary domain: a redirect would turn the POST into a GET and drop it.
  origin = new URL(res.url).origin;
  const batch = (await res.json()).products ?? [];
  products.push(...batch);
  if (batch.length < 250) break;
}

const catalog = buildCatalog(products, origin);
writeFileSync(new URL("../catalog.json", import.meta.url), JSON.stringify(catalog, null, 1));
console.log(`catalog.json (${origin}): ${catalog.products.length} products, request product: ${catalog.request ? catalog.request.handle : "NOT FOUND"}`);
