/**
 * PRD-704 corpus generator.
 *
 * Synthesizes a deterministic 500-SKU product dataset (`data/products.json`)
 * sorted by SKU per PRD-704-R8's deterministic-enumerate MUST. Operators may
 * regenerate with `pnpm regen-corpus`; the JSON file is committed so the
 * example is reproducible without re-running the generator on every build.
 *
 * Determinism: a seeded LCG drives every random choice; the same SKU range
 * always yields the same payload bytes (modulo dataset edits below).
 *
 * The shape mirrors PRD-704 §"Implementation notes — SQLite schema":
 *   sku, name, summary, description_md, specs_json, related_skus, tags.
 *
 * The PRD's Example 2 uses a SQLite snapshot; we ship JSON for a zero-native
 * dependency footprint. PRD-704-R8 is silent on the storage shape — only on
 * deterministic enumerate. JSON keyed by SKU and sorted at write time
 * satisfies the determinism MUST.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
const dataPath = path.join(exampleRoot, 'data', 'products.json');

const SKU_COUNT = 500 as const;

interface ProductRow {
  sku: string;
  name: string;
  summary: string;
  description_md: string;
  /** JSON-stringified specs payload (PRD-704-R6 `data` block carrier). */
  specs_json: string;
  /** CSV of sibling SKUs for cross-sell (PRD-704-R7, capped at 8). */
  related_skus: string;
  /** CSV of taxonomy tags. tags[0] is the category id used by the categorized
   * adapter (PRD-704 amendment A22 — categories as first-class index nodes);
   * remaining tags are cross-cutting filters orthogonal to the category. */
  tags: string;
}

/** Deterministic LCG (Numerical Recipes). 32-bit unsigned. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

type SpecKey =
  | 'weight_g'
  | 'sizes_us'
  | 'diameter_cm'
  | 'length_cm'
  | 'capacity'
  | 'page_count'
  | 'wattage_w'
  | 'driver_mm'
  | 'materials';

interface Category {
  tag: string;
  noun: string;
  specs: readonly SpecKey[];
}

const CATEGORIES: readonly Category[] = [
  { tag: 'footwear', noun: 'Boot', specs: ['weight_g', 'sizes_us', 'materials'] },
  { tag: 'apparel', noun: 'Jacket', specs: ['weight_g', 'sizes_us', 'materials'] },
  { tag: 'kitchen', noun: 'Skillet', specs: ['weight_g', 'diameter_cm', 'materials'] },
  { tag: 'tools', noun: 'Wrench', specs: ['weight_g', 'length_cm', 'materials'] },
  { tag: 'outdoor', noun: 'Tent', specs: ['weight_g', 'capacity', 'materials'] },
  { tag: 'office', noun: 'Notebook', specs: ['weight_g', 'page_count', 'materials'] },
  { tag: 'lighting', noun: 'Lamp', specs: ['weight_g', 'wattage_w', 'materials'] },
  { tag: 'audio', noun: 'Headphone', specs: ['weight_g', 'driver_mm', 'materials'] },
];

const ADJECTIVES = [
  'Heritage',
  'Field',
  'Studio',
  'Pioneer',
  'Workshop',
  'Coastal',
  'Summit',
  'Aurora',
  'Granite',
  'Cedar',
  'Onyx',
  'Harvest',
  'Riverbend',
  'Northwind',
  'Embered',
  'Frost',
];

const COLORS = [
  'Walnut',
  'Charcoal',
  'Indigo',
  'Sage',
  'Bone',
  'Russet',
  'Slate',
  'Ochre',
  'Pine',
  'Sand',
  'Storm',
  'Brick',
];

const ORIGINS = [
  'Portugal',
  'Japan',
  'Italy',
  'United States',
  'Canada',
  'Vietnam',
  'Spain',
  'Mexico',
];

const MATERIAL_VARIANTS = [
  { upper: 'full-grain leather', sole: 'oak-tanned leather', lining: 'vegetable-tanned calfskin' },
  { upper: 'waxed canvas', sole: 'crepe rubber', lining: 'cotton twill' },
  { upper: 'cast iron', sole: 'forged steel', lining: 'enameled cast iron' },
  { upper: 'chrome vanadium', sole: 'rubberized grip', lining: 'powder coat' },
  { upper: 'ripstop nylon', sole: 'aluminum poles', lining: 'mesh inner' },
  { upper: 'recycled paper', sole: 'cloth binding', lining: 'lay-flat spine' },
  { upper: 'steel chassis', sole: 'machined aluminum', lining: 'frosted glass' },
  { upper: 'aluminum housing', sole: 'memory foam', lining: 'oxford weave' },
];

interface SpecPayload {
  weight_g: number;
  sizes_us?: number[];
  diameter_cm?: number;
  length_cm?: number;
  capacity?: string;
  page_count?: number;
  wattage_w?: number;
  driver_mm?: number;
  materials: { upper: string; sole: string; lining: string };
  care: string;
  made_in: string;
}

function buildSpecs(rng: () => number, category: Category): SpecPayload {
  const materials = MATERIAL_VARIANTS[Math.floor(rng() * MATERIAL_VARIANTS.length)]!;
  const made_in = ORIGINS[Math.floor(rng() * ORIGINS.length)]!;
  const base: SpecPayload = {
    weight_g: 200 + Math.floor(rng() * 1800),
    materials,
    care: 'wipe with a damp cloth',
    made_in,
  };
  if (category.specs.includes('sizes_us')) {
    base.sizes_us = [8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12];
  }
  if (category.specs.includes('diameter_cm')) base.diameter_cm = 20 + Math.floor(rng() * 20);
  if (category.specs.includes('length_cm')) base.length_cm = 10 + Math.floor(rng() * 30);
  if (category.specs.includes('capacity')) base.capacity = `${1 + Math.floor(rng() * 6)}-person`;
  if (category.specs.includes('page_count')) base.page_count = 80 + Math.floor(rng() * 240);
  if (category.specs.includes('wattage_w')) base.wattage_w = 5 + Math.floor(rng() * 60);
  if (category.specs.includes('driver_mm')) base.driver_mm = 30 + Math.floor(rng() * 30);
  return base;
}

function buildDescription(name: string, made_in: string, category: Category): string {
  return [
    `# ${name}`,
    '',
    `Built for daily wear and refinishing. The ${name} is designed for the long haul, with ${category.tag}-grade materials and a quiet, considered fit and finish.`,
    '',
    '## Highlights',
    '',
    `- Crafted in ${made_in}.`,
    '- Repairable construction with serviceable parts.',
    '- Backed by a one-year materials warranty.',
    '',
    '## Care',
    '',
    'Condition every 60 days for best results. Spot-clean only; avoid harsh detergents. Store in a cool, dry place out of direct sunlight.',
  ].join('\n');
}

function pad6(n: number): string {
  return n.toString().padStart(6, '0');
}

function generate(): ProductRow[] {
  const rng = makeRng(0xDEADBEEF);
  const rows: ProductRow[] = [];
  for (let i = 1; i <= SKU_COUNT; i += 1) {
    const sku = `sku-${pad6(i)}`;
    const category = CATEGORIES[i % CATEGORIES.length]!;
    const adjective = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)]!;
    const color = COLORS[Math.floor(rng() * COLORS.length)]!;
    const name = `${adjective} ${category.noun} — ${color}`;
    const specs = buildSpecs(rng, category);
    const summary = `${adjective} ${category.noun.toLowerCase()} in ${color.toLowerCase()}; built in ${specs.made_in} for daily use.`;
    const description_md = buildDescription(name, specs.made_in, category);

    // PRD-704-R7 — cap related[] at 8; cross-sell within the same category.
    const related: string[] = [];
    for (let off = -4; off <= 4; off += 1) {
      if (off === 0) continue;
      // category-mate: SKUs that share `i % CATEGORIES.length`.
      const candidate = i + off * CATEGORIES.length;
      if (candidate >= 1 && candidate <= SKU_COUNT) related.push(`sku-${pad6(candidate)}`);
      if (related.length >= 8) break;
    }

    const tags = [category.tag, `made-in-${specs.made_in.toLowerCase().replace(/ /g, '-')}`, color.toLowerCase()];

    rows.push({
      sku,
      name,
      summary,
      description_md,
      specs_json: JSON.stringify(specs),
      related_skus: related.join(','),
      tags: tags.join(','),
    });
  }
  // PRD-704-R8 — sort by SKU; the JSON file is the canonical sorted form.
  rows.sort((a, b) => a.sku.localeCompare(b.sku));
  return rows;
}

async function main(): Promise<void> {
  const rows = generate();
  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(dataPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${rows.length} products to ${dataPath}.`);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
