import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addLine, bagTotal, buildCatalog, cartFields, cleanPersonalization, cleanSource, fileProblem, findRequestProduct,
  reconcileBag, zipOk,
} from "../lib.js";

const prod = (o) => ({
  id: 1, handle: "palmetto-ornament", title: "Palmetto ornament", product_type: "Ornaments", tags: [], body_html: "<p>Hand&nbsp;finished</p>",
  images: [{ src: "https://cdn.shopify.com/a.png" }], options: [{ name: "Title" }],
  variants: [{ id: 11, title: "Default Title", price: "18.00", available: true }], ...o,
});
const request = prod({ id: 9, handle: "custom-request", title: "Custom request", tags: ["request-product"], variants: [{ id: 99, price: "0.00", available: true }] });

test("finds the free request product by tag or handle, never a paid one", () => {
  assert.deepEqual(findRequestProduct([prod(), request]), { productId: 9, handle: "custom-request", variantId: 99 });
  assert.equal(findRequestProduct([prod({ handle: "custom-request" })]), null, "a $18 product is never a request product");
  assert.equal(findRequestProduct([prod({ tags: "request-product", variants: [{ id: 1, price: "0.00" }, { id: 2, price: "5.00" }] })]), null);
  assert.equal(findRequestProduct([prod({ handle: "request", variants: [{ id: 5, price: "0", available: false }] })]), null, "unavailable");
});

test("catalog hides the request product, cleans text and reads the customizable tag", () => {
  const quote = prod({ id: 7, handle: "custom-3d-print-quote", tags: ["custom", "quote"], variants: [{ id: 70, price: "15.00", available: false }] });
  const cat = buildCatalog([prod(), prod({ id: 2, handle: "sign", tags: "Customizable, decor" }), request, quote], "https://charleston3d.com");
  assert.equal(cat.request.variantId, 99);
  assert.deepEqual(cat.products.map((p) => p.id), [1, 2]);
  assert.equal(cat.products[0].customizable, false);
  assert.equal(cat.products[1].customizable, true);
  assert.equal(cat.products[0].description, "Hand finished");
  assert.equal(cat.products[0].variants[0].price, 1800);
  assert.equal(cat.products[0].variants[0].title, "");
  assert.deepEqual(cat.products[0].options, []);
  assert.match(cat.products[0].image, /\?width=600$/);
});

test("cart post has one items[n] group per line, personalization and source", () => {
  const f = cartFields([{ variantId: 11, qty: 2, personalization: "Lewis" }, { variantId: 12, qty: 99 }], "qr-card");
  assert.deepEqual(f, [
    ["items[0][id]", "11"], ["items[0][quantity]", "2"], ["items[0][properties][Personalization]", "Lewis"], ["items[0][properties][_Source]", "qr-card"],
    ["items[1][id]", "12"], ["items[1][quantity]", "50"], ["items[1][properties][_Source]", "qr-card"],
    ["return_to", "/cart"],
  ]);
  assert.ok(!cartFields([{ variantId: 1, qty: 1 }], "").some(([k]) => k.includes("_Source")));
});

test("bag merges the same item and name, keeps different names apart", () => {
  let b = addLine([], { variantId: 1, qty: 1, personalization: "Ann", price: 1000 });
  b = addLine(b, { variantId: 1, qty: 2, personalization: "Ann", price: 1000 });
  b = addLine(b, { variantId: 1, qty: 1, personalization: "Bo", price: 1000 });
  assert.deepEqual(b.map((l) => [l.personalization, l.qty]), [["Ann", 3], ["Bo", 1]]);
  assert.equal(bagTotal(b), 4000);
});

test("bag drops sold-out or removed items and refreshes prices", () => {
  const products = buildCatalog([prod({ variants: [{ id: 11, title: "Default Title", price: "20.00", available: true }, { id: 12, title: "Big", price: "30.00", available: false }] })], "x").products;
  const out = reconcileBag([{ variantId: 11, qty: 1, price: 1 }, { variantId: 12, qty: 1 }, { variantId: 404, qty: 1 }, { variantId: 11, qty: 1, personalization: "Zed" }], products);
  assert.deepEqual(out.map((l) => [l.variantId, l.price]), [[11, 2000]], "named line dropped because the item isn't customizable");
});

test("personalization is trimmed, single-line and capped at 60", () => {
  assert.equal(cleanPersonalization("  The\n Lewis   Family "), "The Lewis Family");
  assert.equal(cleanPersonalization("x".repeat(80)).length, 60);
});

test("file checks: type, empty and size", () => {
  assert.equal(fileProblem({ name: "a.STL", size: 10 }, "model"), "");
  assert.equal(fileProblem({ name: "photo.heic", size: 10 }, "image"), "");
  assert.match(fileProblem({ name: "a.exe", size: 10 }, "image"), /JPG/);
  assert.match(fileProblem({ name: "a.png", size: 10 }, "model"), /STL/);
  assert.match(fileProblem({ name: "a.stl", size: 0 }, "model"), /empty/);
  assert.match(fileProblem({ name: "a.stl", size: 21 * 1048576 }, "model"), /over 20 MB/);
  assert.equal(fileProblem(undefined, "model"), "");
});

test("ZIP and source tag", () => {
  assert.ok(zipOk("29401") && zipOk("29401-1234") && zipOk(""));
  assert.ok(!zipOk("2940") && !zipOk("abcde"));
  assert.equal(cleanSource("qr-card<script>"), "qr-cardscript");
  assert.equal(cleanSource(null), "");
});
