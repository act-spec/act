/**
 * PRD-704 — programmatic adapter wiring (categorized).
 *
 * Wraps `data/products.json` (the deterministic corpus emitted by
 * `scripts/generate-corpus.ts`) into a PRD-208 programmatic adapter via
 * `defineProgrammaticAdapter`.
 *
 * Graph shape (categorized — superseded PRD-704-R8 #1's tags-not-categories
 * choice; see amendment in `docs/amendments-queue.md`):
 *
 *     catalog (synthetic root)
 *       ├── apparel   ← index node
 *       │     └── sku-* (~62 each)
 *       ├── kitchen   ← index node
 *       │     └── sku-*
 *       └── … (8 category index nodes total)
 *
 * The categories sit between the synthetic root and the product leaves so
 * agents can walk subtrees scoped to a single category instead of pulling
 * the flat 500-entry index. `metadata.tags` is preserved on every product
 * for cross-cutting filters orthogonal to category.
 *
 * Per-product invariants per PRD-704: id grammar (R5), schema_org_type pin,
 * exactly two extracted_via=adapter blocks (R6), related[] capped at 8 (R7),
 * source attribution (R9), pre-computed token counts (R11 + amendments A18).
 *
 * `source.human_url` is populated on every node when `ctx.siteOrigin` is set
 * (PRD-100 node schema). The root maps to the storefront landing page; each
 * product maps to `/p/{sku}/`. Category nodes do not currently have a
 * dedicated storefront page so their `human_url` is left unset.
 */
import { promises as fs } from 'node:fs';

import type { AdapterCapabilities, EmittedNode } from '@act-spec/adapter-framework';
import { defineProgrammaticAdapter } from '@act-spec/adapter-programmatic';

/** Shape of a row in `data/products.json`. */
export interface ProductRow {
  sku: string;
  name: string;
  summary: string;
  description_md: string;
  /** JSON-stringified specs payload — the `data` block's canonical text. */
  specs_json: string;
  /** CSV of sibling SKUs. */
  related_skus: string;
  /** CSV of taxonomy tags; tags[0] is the category tag. */
  tags: string;
}

export interface CatalogAdapterOptions {
  /** Absolute path to the JSON dataset. */
  databasePath: string;
  /** ID of the synthetic catalog root (PRD-704-R2 root subtree carrier). */
  catalogRootId?: string;
}

const DEFAULT_ROOT_ID = 'catalog' as const;

/**
 * Categories the corpus generator stamps onto each product (the `tag` field
 * of each `Category` in scripts/generate-corpus.ts). Order is the order
 * children are listed under the catalog root and the order subtrees fan out.
 */
const CATEGORY_TAGS = [
  'footwear',
  'apparel',
  'kitchen',
  'tools',
  'outdoor',
  'office',
  'lighting',
  'audio',
] as const;

const CATEGORY_TITLES: Record<string, string> = {
  footwear: 'Footwear',
  apparel: 'Apparel',
  kitchen: 'Kitchen',
  tools: 'Tools',
  outdoor: 'Outdoor',
  office: 'Office',
  lighting: 'Lighting',
  audio: 'Audio',
};

/** Naive whitespace token estimator (mirrors @act-spec/adapter-markdown pattern). */
function naiveTokenCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function parseTags(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** First tag is the category per `scripts/generate-corpus.ts`. */
function categoryOf(row: ProductRow): string {
  const t = parseTags(row.tags)[0];
  if (t === undefined || !CATEGORY_TAGS.includes(t as (typeof CATEGORY_TAGS)[number])) {
    throw new Error(
      `PRD-704: product ${row.sku} has no recognized category tag (got: ${row.tags})`,
    );
  }
  return t;
}

function buildProductNode(
  row: ProductRow,
  parentCategory: string,
  siteOrigin: string | undefined,
): EmittedNode {
  let specsValue: unknown;
  try {
    specsValue = JSON.parse(row.specs_json);
  } catch (err) {
    throw new Error(
      `PRD-704-R6: product ${row.sku} has malformed specs_json (${(err as Error).message}); regenerate the corpus`,
    );
  }
  // related[] uses the post-A5 schema shape; cross-sells stay within the
  // same category (the corpus generator picks siblings by `i % CATEGORIES`).
  const related = parseTags(row.related_skus)
    .slice(0, 8)
    .map((id) => ({ id, relation: 'see-also' as const }));
  const tags = parseTags(row.tags);

  // PRD-704-R6 — exactly two blocks, in this order, both extracted_via=adapter.
  const content = [
    {
      type: 'prose' as const,
      format: 'markdown' as const,
      text: row.description_md,
      metadata: { extracted_via: 'adapter' as const },
    },
    {
      type: 'data' as const,
      format: 'json' as const,
      text: row.specs_json,
      value: specsValue,
      metadata: { extracted_via: 'adapter' as const },
    },
  ];

  const summaryTokens = naiveTokenCount(row.summary);
  const bodyTokens = naiveTokenCount(row.description_md) + naiveTokenCount(row.specs_json);
  const etagPlaceholder = 's256:AAAAAAAAAAAAAAAAAAAAAA' as const;

  return {
    act_version: '0.1',
    id: row.sku,
    type: 'product',
    title: row.name,
    summary: row.summary,
    summary_source: 'author', // PRD-100-R23 — DB-supplied row.summary is author-written.
    parent: parentCategory,
    etag: etagPlaceholder,
    tokens: { summary: summaryTokens, body: bodyTokens },
    content,
    related,
    metadata: {
      schema_org_type: 'Product',
      tags,
      source: { adapter: 'act-catalog', source_id: row.sku },
    },
    ...(siteOrigin !== undefined ? { source: { human_url: `${siteOrigin}/p/${row.sku}/` } } : {}),
  } as EmittedNode;
}

function buildCategoryNode(
  tag: string,
  rootId: string,
  childSkus: readonly string[],
  siteOrigin: string | undefined,
): EmittedNode {
  const title = CATEGORY_TITLES[tag] ?? tag;
  const summary = `${title} — ${childSkus.length} product${childSkus.length === 1 ? '' : 's'} grouped under the ${tag} category.`;
  const intro = [
    `# ${title}`,
    '',
    `Subtree fanout for the ${tag} category. Walking this subtree returns the category node plus its ${childSkus.length} product children — agents looking for ${tag} can fetch this scope without scanning the flat catalog index.`,
  ].join('\n');
  const summaryTokens = naiveTokenCount(summary);
  const bodyTokens = naiveTokenCount(intro);
  return {
    act_version: '0.1',
    id: tag,
    type: 'index',
    title,
    summary,
    parent: rootId,
    children: [...childSkus],
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    tokens: { summary: summaryTokens, body: bodyTokens },
    content: [
      {
        type: 'prose' as const,
        format: 'markdown' as const,
        text: intro,
        metadata: { extracted_via: 'adapter' as const },
      },
    ],
    metadata: {
      tags: [tag],
      source: { adapter: 'act-catalog', source_id: tag },
    },
    ...(siteOrigin !== undefined ? { source: { human_url: `${siteOrigin}/c/${tag}/` } } : {}),
  } as EmittedNode;
}

function buildCatalogRootNode(
  rootId: string,
  productCount: number,
  categoryIds: readonly string[],
  siteOrigin: string | undefined,
): EmittedNode {
  const summary = `Acme Catalog — ${productCount} products grouped into ${categoryIds.length} categories.`;
  const intro = [
    '# Acme Catalog',
    '',
    `Root of the categorized catalog graph. ${productCount} products live under ${categoryIds.length} category index nodes (${categoryIds.join(', ')}).`,
    '',
    'Agents that respect the subtree contract walk root → category → product and never have to load the flat index. Cross-cutting tags remain on every product node for filters orthogonal to category.',
  ].join('\n');
  const summaryTokens = naiveTokenCount(summary);
  const bodyTokens = naiveTokenCount(intro);
  return {
    act_version: '0.1',
    id: rootId,
    type: 'index',
    title: 'Acme Catalog',
    summary,
    children: [...categoryIds],
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    tokens: { summary: summaryTokens, body: bodyTokens },
    content: [
      {
        type: 'prose' as const,
        format: 'markdown' as const,
        text: intro,
        metadata: { extracted_via: 'adapter' as const },
      },
    ],
    metadata: {
      source: { adapter: 'act-catalog', source_id: rootId },
    },
    ...(siteOrigin !== undefined ? { source: { human_url: `${siteOrigin}/` } } : {}),
  } as EmittedNode;
}

interface CorpusItem {
  kind: 'root' | 'category' | 'product';
  /** category tag, present for kind=category and kind=product. */
  category?: string;
  /** populated for kind=product. */
  row?: ProductRow;
  /** populated for kind=category — child SKU ids in deterministic order. */
  childSkus?: readonly string[];
}

/** Adapter capabilities per PRD-704-R8 #8. */
export const CATALOG_CAPABILITIES: AdapterCapabilities = {
  level: 'standard',
  precedence: 'primary',
  concurrency_max: 8,
  namespace_ids: false,
  manifestCapabilities: { etag: true, subtree: true },
};

/**
 * PRD-704-R8 — factory entry. `defineProgrammaticAdapter` returns a
 * PRD-200-conformant Adapter; the build script feeds it to `runPipeline`
 * from `@act-spec/generator-core`.
 */
export function createCatalogAdapter(opts: CatalogAdapterOptions) {
  const rootId = opts.catalogRootId ?? DEFAULT_ROOT_ID;
  let cachedRows: ProductRow[] | undefined;
  let cachedByCategory: Map<string, ProductRow[]> | undefined;

  async function loadRows(): Promise<ProductRow[]> {
    if (cachedRows) return cachedRows;
    const raw = await fs.readFile(opts.databasePath, 'utf8');
    const parsed = JSON.parse(raw) as ProductRow[];
    if (!Array.isArray(parsed)) {
      throw new Error(
        `PRD-704-R8: ${opts.databasePath} did not contain a JSON array of product rows`,
      );
    }
    // PRD-704-R8 #6 — sort by sku ASC; promotes PRD-208-R6 SHOULD to MUST.
    cachedRows = [...parsed].sort((a, b) => a.sku.localeCompare(b.sku));
    return cachedRows;
  }

  function groupByCategory(rows: readonly ProductRow[]): Map<string, ProductRow[]> {
    if (cachedByCategory) return cachedByCategory;
    const m = new Map<string, ProductRow[]>();
    for (const tag of CATEGORY_TAGS) m.set(tag, []);
    for (const r of rows) {
      const cat = categoryOf(r);
      const bucket = m.get(cat);
      if (bucket === undefined) {
        throw new Error(`PRD-704: unknown category tag "${cat}" on ${r.sku}`);
      }
      bucket.push(r);
    }
    // Each bucket inherits the deterministic SKU order from `rows`.
    cachedByCategory = m;
    return m;
  }

  return defineProgrammaticAdapter<Record<string, unknown>, CorpusItem>({
    name: 'act-catalog',
    namespaceIds: false,
    validate: 'before-emit',
    strict: true,
    capabilities: CATALOG_CAPABILITIES,

    async *enumerate() {
      const rows = await loadRows();
      const byCategory = groupByCategory(rows);
      // Synthetic root first; then categories in declared order; then
      // products in deterministic SKU order.
      yield { kind: 'root' };
      for (const tag of CATEGORY_TAGS) {
        const bucket = byCategory.get(tag) ?? [];
        yield { kind: 'category', category: tag, childSkus: bucket.map((r) => r.sku) };
      }
      for (const row of rows) {
        yield { kind: 'product', category: categoryOf(row), row };
      }
    },

    transform(item, ctx) {
      if (item.kind === 'root') {
        const productCount = (cachedRows ?? []).length;
        return buildCatalogRootNode(rootId, productCount, CATEGORY_TAGS, ctx.siteOrigin);
      }
      if (item.kind === 'category') {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return buildCategoryNode(item.category!, rootId, item.childSkus ?? [], ctx.siteOrigin);
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return buildProductNode(item.row!, item.category!, ctx.siteOrigin);
    },
  });
}

export const CATALOG_ROOT_ID = DEFAULT_ROOT_ID;
export const CATALOG_CATEGORIES = CATEGORY_TAGS;
