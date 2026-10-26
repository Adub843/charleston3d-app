# Charleston3D app

A small web app (add-to-home-screen ready) for ordering from Charleston3D:

- **Shop**: every product published on the Charleston3D store, with search and type filters. Products the
  console marks **Customizable** (tag `customizable`) ask for a "Name to print" (max 60 characters).
  The bag checks out in one post to the store's cart, so payment, shipping and tax all run through Shopify.
- **Request or custom print** (one page): an item that isn't listed, or a custom design, with a description,
  optional example link, up to 2 photos/PDF sketches and one 3D file (STL, 3MF, OBJ, STEP), 20 MB each. Free.
  Links: `#request` (old `#find` and `#custom` links still work and tick the matching choice).

The request form posts straight to the store's cart as the **$0 request product**, with the text and files as
line item properties, exactly like the theme's Custom page. Requests land in Shopify Orders with the files
attached. Nothing is stored anywhere else and there's no server or payment code in this app.

The request product is found automatically: a product tagged `request-product`, or with the handle
`custom-request`, priced $0.00 on every variant and available on the Online Store. If there isn't one, the
request tabs show an "Email your request" button instead.

## How it's published

GitHub Pages, on every push to `main` and every hour (`.github/workflows/deploy.yml`). Each run:

1. runs the tests,
2. rebuilds `catalog.json` from `https://charleston3d.com/products.json` (no token needed),
3. checks the store accepts the app's multi-item cart post (`scripts/cart-smoke.mjs`, uses a throwaway cart),
4. publishes. Address: `app.charleston3d.com` (`CNAME`).

To use another store address, set the repository variable `STORE_URL`.

## Files

- `index.html`, `app.js`, `lib.js`, `styles.css`, `manifest.webmanifest`, `icons/`: the app
- `scripts/sync-catalog.mjs`: builds `catalog.json`
- `tests/lib.test.mjs`: `node --test tests/*.test.mjs`

QR codes and links can add `?src=<tag>` (letters, digits, dashes). The tag is saved on the order as `_Source`.
