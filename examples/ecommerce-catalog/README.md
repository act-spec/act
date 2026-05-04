# E-commerce catalog with ACT

A real, runnable [Astro 4](https://astro.build) storefront fed by a 500-SKU dataset. Browse the product list and detail pages in a browser; the same dataset is emitted as ACT nodes at `/.well-known/act.json` + `/act/...` for AI agents to consume.

This is the "no CMS, no markdown" pattern: your products live in a database (or any custom store), and the **programmatic adapter** is a tiny enumerate-and-transform function that turns each row into one ACT node. It's the escape hatch when none of the off-the-shelf adapters fit.

The example also doubles as the canonical **progressive-disclosure demo** for ACT: SKUs sit under category index nodes, the root subtree is shallow, and `source.human_url` points each ACT node at its rendered storefront page.

## The stack

- **Astro 4** for the storefront UI (any framework works — this could be Next.js, Remix, or plain HTML)
- **JSON product data** at `data/products.json` — stand-in for whatever store you already have
- **`@act-spec/adapter-programmatic`** as the source — a tiny adapter wrapping the JSON
- **`@act-spec/generator-core`** to run the pipeline and emit files
- **`@act-spec/plugin-astro`** (optional) to wire generation into `astro build`

## How ACT plugs in

The programmatic adapter takes two functions:

- `enumerate()` — yields an iterable of items (whatever shape you want).
- `transform(item, ctx)` — turns one item into one ACT node. `ctx.siteOrigin` carries the canonical URL, so the adapter can populate `source.human_url`.

ACT calls them, runs the nodes through the pipeline, and writes the JSON envelopes:

```
public/                              ← in dev: served at the origin root
├── .well-known/act.json
└── act/
    ├── index.json                   # 509 entries (root + 8 categories + 500 SKUs)
    ├── nodes/
    │   ├── catalog.json             # synthetic root, children: [8 categories]
    │   ├── kitchen.json (etc.)      # × 8 category index nodes
    │   └── sku-NNNNNN.json          # × 500
    └── subtrees/
        └── catalog.json             # depth=1: root + 8 categories
```

There's no markdown to walk, no CMS to query. The adapter is a thin wrapper around your data source.

## Quick start (your project)

Add ACT to your existing Astro storefront in **three steps**:

**1. Install:**

```sh
pnpm add @act-spec/plugin-astro @act-spec/adapter-programmatic @act-spec/generator-core
```

**2. Write a tiny catalog adapter** — `src/act-catalog.ts`:

> **Summaries are required on every node** (PRD-100-R21). The programmatic adapter doesn't have a body to extract from automatically — the user transform owns the field. Two patterns: (a) prefer an author-written `row.shortDescription` / similar; (b) fall back to `extractFirstSentence(row.description, 50)` from `@act-spec/adapter-programmatic` when no author summary exists. The example below uses both.

```ts
import { defineProgrammaticAdapter, extractFirstSentence } from '@act-spec/adapter-programmatic';
import { fetchProducts, fetchProductBySku, fetchCategories } from './your-store';

export const catalogAdapter = defineProgrammaticAdapter({
  name: 'act-catalog',
  validate: 'before-emit',
  capabilities: { level: 'standard', precedence: 'primary' },

  async *enumerate() {
    const categories = await fetchCategories();   // e.g., ['kitchen', 'apparel', …]
    const products = await fetchProducts();
    yield { kind: 'root' as const, categories };
    for (const cat of categories) {
      const skus = products.filter((p) => p.category === cat).map((p) => p.sku);
      yield { kind: 'category' as const, tag: cat, skus };
    }
    for (const p of products) yield { kind: 'product' as const, sku: p.sku, category: p.category };
  },

  async transform(item, ctx) {
    if (item.kind === 'root') {
      return {
        id: 'catalog',
        type: 'index',
        title: 'Catalog',
        summary: 'All products, grouped by category.',
        children: item.categories,
        source: ctx.siteOrigin ? { human_url: `${ctx.siteOrigin}/` } : undefined,
      };
    }
    if (item.kind === 'category') {
      return {
        id: item.tag,
        type: 'index',
        title: item.tag,
        summary: `${item.tag} products`,
        parent: 'catalog',
        children: item.skus,
      };
    }
    const p = await fetchProductBySku(item.sku);
    return {
      id: p.sku,
      type: 'product',
      parent: item.category,
      title: p.name,
      // Author summary first; if your data doesn't have one, the helper
      // pulls the first sentence of the description and clamps it to 50
      // tokens. For higher-quality summaries, plug in an LLM call here.
      summary: p.shortDescription ?? extractFirstSentence(p.description, 50),
      content: [
        { type: 'prose', format: 'markdown', text: p.description },
        { type: 'data', format: 'json', text: JSON.stringify(p.specs) },
      ],
      metadata: { schema_org_type: 'Product' },
      source: ctx.siteOrigin ? { human_url: `${ctx.siteOrigin}/p/${p.sku}/` } : undefined,
    };
  },
});
```

**3. Wire it into `astro.config.mjs`:**

```js
import { defineConfig } from 'astro/config';
import act from '@act-spec/plugin-astro';
import { catalogAdapter } from './src/act-catalog.ts';

export default defineConfig({
  site: 'https://your-store.example',  // becomes ctx.siteOrigin → source.human_url
  integrations: [
    act({
      level: 'standard',
      site: { name: 'Your Store' },
      subtreeDepth: 1,                  // shallow root subtree; agents walk children[]
      urlTemplates: {
        indexUrl: '/act/index.json',
        nodeUrlTemplate: '/act/nodes/{id}.json',
        subtreeUrlTemplate: '/act/subtrees/{id}.json',
      },
      adapters: [
        { adapter: catalogAdapter, config: {}, actVersion: '0.1' },
      ],
    }),
  ],
});
```

`astro build` now emits ACT files into `dist/.well-known/` and `dist/act/` alongside your storefront.

> Not on Astro? The same `catalogAdapter` works with any framework via `@act-spec/generator-core`'s `runPipeline` + `emitFiles` — no Astro required. See `scripts/build.ts` in this folder for that pattern.

## Run this example

ACT artifacts are generated by `scripts/build.ts` directly into Astro's `public/` folder so the dev server serves them at the same origin as the storefront.

```sh
pnpm install                                              # from the repo root
pnpm -F @act-spec/example-ecommerce-catalog regen-corpus  # rebuild data/products.json
pnpm -F @act-spec/example-ecommerce-catalog build         # ACT files → public/
pnpm -F @act-spec/example-ecommerce-catalog dev           # http://localhost:4321

# Browse both sides at the same origin:
#   http://localhost:4321/                        ← product grid
#   http://localhost:4321/p/sku-000001/           ← product detail
#   http://localhost:4321/.well-known/act.json    ← ACT manifest
#   http://localhost:4321/act/index.json          ← ACT index (509 nodes)
#   http://localhost:4321/act/subtrees/catalog.json   ← root subtree (8 categories)
#   http://localhost:4321/act/nodes/kitchen.json  ← a category index node
#   http://localhost:4321/act/nodes/sku-000003.json
```

### Verifying ACT against the rendered pages

With `pnpm dev` running, open any product page and compare:

```sh
curl http://localhost:4321/act/nodes/sku-000003.json | jq '{id, title, parent, source, blocks: [.content[]?.type]}'
```

The product page on screen and the ACT node should agree on title, summary, description (`prose` block), specs (`data` block), and `source.human_url`. The `parent` is the SKU's category id (e.g. `tools`), not the synthetic `catalog` root.

## Why categories instead of one flat list

The catalog graph is layered:

```
catalog            (synthetic root, children: 8)
  ├── apparel      (index node, children: 62)
  │     └── sku-000002, sku-000010, …
  ├── kitchen      (index node, children: 62)
  │     └── sku-000003, sku-000011, …
  └── … (8 categories total)
```

Two reasons this matters more than a flat 500-SKU list:

**Reason 1 — agents walk subtree → subtree → node, summary all the way down.**

Every inner node has its own subtree file (`/act/subtrees/{id}.json`). Each subtree carries the **root** node in full plus every immediate descendant as a **summary entry** — full envelope shape (id, type, title, summary, parent, children, tokens, etag, source, metadata, related, tags) but with `content: []`. Bodies are fetched lazily per-node only when the agent decides what to read.

```
manifest → /act/subtrees/catalog.json    ← root + 8 categories (summary)
        → /act/subtrees/kitchen.json     ← kitchen + 62 SKUs (summary)
        → /act/nodes/sku-000003.json     ← only here is the body fetched
```

The contract is the same recursively: every step shows you what's at the next level without paying the body cost. `tokens.body` is preserved on each summary entry so the agent can budget before drilling in.

| Walk path | Bytes (real, this corpus) | ~Tokens |
|---|---|---|
| ACT recursive walk (manifest + 2 subtrees + SKU node) | 0.6 KB + 17.5 KB + 93 KB + 2 KB ≈ **113 KB** | ~29 k |
| HTML equivalent (3 rendered pages) | ~256 KB | ~65 k |
| Flat `index.json` (brute-force enumerate) | ~162 KB | ~41 k |

The flat index is still emitted (a Standard producer MUST advertise one), but a subtree-walking agent never has to read it.

**Reason 2 — `source.human_url` makes ACT nodes navigable.**

Every product node carries `source.human_url` pointing at `${siteOrigin}/p/${sku}/`; categories at `${siteOrigin}/c/{tag}/`; the synthetic root at `${siteOrigin}/`. An agent holding an ACT node can pivot to the rendered storefront page; an inspector can compare ACT against HTML; the site browser at `apps/site-browser` uses the URLs to compute "what would the agent have spent on the HTML side instead" alongside the ACT walk total.

```sh
# Recursive ACT walk: navigate, then fetch one body
curl -s http://localhost:4321/.well-known/act.json
curl -s http://localhost:4321/act/subtrees/catalog.json   # 8 category summaries
curl -s http://localhost:4321/act/subtrees/kitchen.json   # 62 SKU summaries
curl -s http://localhost:4321/act/nodes/sku-000003.json   # full body — only here

# HTML equivalent — what the agent would have spent without ACT:
curl -s http://localhost:4321/                            # storefront landing
curl -s http://localhost:4321/c/kitchen/                  # category page
curl -s http://localhost:4321/p/sku-000003/               # product page
```

The HTML side carries layout, navigation, scripts, and styles the agent doesn't need; the ACT side carries product data and nothing else. The site browser shows both totals side by side as you walk the tree.

## What the corpus shows

- **8 category index nodes + 500 product nodes** under one synthetic `catalog` root. The root subtree is depth 1 (~20 KB) so agents see the category fanout in one fetch but don't pay for inlined products.
- **Two blocks per product**: a `prose` description block (markdown) + a `data` specs block (JSON).
- **Within-category cross-sells** via `related[]` on each product, capped at 8.
- **`metadata.tags` preserved** on every product (category tag + made-in + color) for cross-cutting filters orthogonal to the category hierarchy.
- **`source.human_url` on every applicable node** — root maps to `/`, products map to `/p/{sku}/`. Categories don't have a dedicated storefront page in this example, so they ship without `human_url`.
- **Deterministic** corpus — the same seed produces a byte-equivalent dataset every run, so the ACT output is reproducible.
