import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.join(here, '..', '..', 'data', 'products.json');

export interface ProductRow {
  sku: string;
  name: string;
  summary: string;
  description_md: string;
  specs_json: string;
  related_skus: string;
  tags: string;
}

export interface Product {
  sku: string;
  name: string;
  summary: string;
  description: string;
  specs: Record<string, unknown>;
  related: string[];
  tags: string[];
  /** First tag is the category id; same convention `catalog-adapter.ts` uses. */
  category: string;
}

let cache: Product[] | undefined;

export async function loadProducts(): Promise<Product[]> {
  if (cache) return cache;
  const raw = await fs.readFile(databasePath, 'utf8');
  const rows = JSON.parse(raw) as ProductRow[];
  cache = rows
    .map((r) => {
      const tags = r.tags.split(',').map((s) => s.trim()).filter(Boolean);
      return {
        sku: r.sku,
        name: r.name,
        summary: r.summary,
        description: r.description_md,
        specs: JSON.parse(r.specs_json) as Record<string, unknown>,
        related: r.related_skus.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8),
        tags,
        category: tags[0] ?? 'uncategorized',
      };
    })
    .sort((a, b) => a.sku.localeCompare(b.sku));
  return cache;
}

export async function getProduct(sku: string): Promise<Product | undefined> {
  const products = await loadProducts();
  return products.find((p) => p.sku === sku);
}

/** Same eight categories the ACT adapter promotes to index nodes. */
export const CATEGORIES = [
  { id: 'footwear', title: 'Footwear' },
  { id: 'apparel', title: 'Apparel' },
  { id: 'kitchen', title: 'Kitchen' },
  { id: 'tools', title: 'Tools' },
  { id: 'outdoor', title: 'Outdoor' },
  { id: 'office', title: 'Office' },
  { id: 'lighting', title: 'Lighting' },
  { id: 'audio', title: 'Audio' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export async function loadCategories(): Promise<
  Array<{ id: string; title: string; count: number; sampleSummary: string }>
> {
  const products = await loadProducts();
  return CATEGORIES.map((cat) => {
    const skus = products.filter((p) => p.category === cat.id);
    const sample = skus[0];
    return {
      id: cat.id,
      title: cat.title,
      count: skus.length,
      sampleSummary: sample !== undefined ? sample.summary : '',
    };
  });
}

export async function loadProductsInCategory(category: string): Promise<Product[]> {
  const products = await loadProducts();
  return products.filter((p) => p.category === category);
}
