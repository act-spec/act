/**
 * One-shot codegen: walk schemas/ in repo root, emit a TS module per schema
 * via json-schema-to-typescript, plus a barrel index.
 *
 * Invoked via `pnpm -F @act-spec/core codegen`. Output is gitignored
 * (packages/core/src/generated/) and rebuilt on demand.
 *
 * Source of truth = schemas/ (locked at G1 by the Spec Steward).
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, type JSONSchema } from 'json-schema-to-typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const schemasDir = path.join(repoRoot, 'schemas');
const outDir = path.join(here, '..', 'src', 'generated');

interface SchemaTarget {
  /** PRD series directory (e.g. "100", "102"). */
  series: string;
  /** File basename without `.schema.json`. */
  name: string;
  /** Absolute path to the schema file. */
  filePath: string;
  /** Module-safe symbol prefix derived from name (e.g. "BlockMarketingNamespace"). */
  typeName: string;
}

function toTypeName(name: string): string {
  // "block-marketing-namespace" -> "BlockMarketingNamespace"
  return name
    .split(/[-_]/g)
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join('');
}

async function discover(): Promise<SchemaTarget[]> {
  const seriesEntries = await fs.readdir(schemasDir, { withFileTypes: true });
  const targets: SchemaTarget[] = [];
  for (const entry of seriesEntries) {
    if (!entry.isDirectory()) continue;
    const series = entry.name;
    if (!/^\d{3}$/.test(series)) continue;
    const seriesDir = path.join(schemasDir, series);
    const files = await fs.readdir(seriesDir);
    for (const file of files) {
      if (!file.endsWith('.schema.json')) continue;
      const name = file.replace(/\.schema\.json$/, '');
      targets.push({
        series,
        name,
        filePath: path.join(seriesDir, file),
        typeName: toTypeName(name),
      });
    }
  }
  return targets.sort((a, b) =>
    a.series === b.series ? a.name.localeCompare(b.name) : a.series.localeCompare(b.series),
  );
}

/**
 * json-schema-to-typescript delegates remote `$ref` resolution to
 * `@apidevtools/json-schema-ref-parser`. Our schemas use canonical
 * `https://act-spec.org/...` `$id`s, but in this offline context we want to
 * resolve them locally. Build an in-memory map from `$id` to the parsed
 * schema, then plug a custom resolver into ref-parser.
 */
async function buildLocalSchemaIndex(): Promise<Map<string, JSONSchema>> {
  const map = new Map<string, JSONSchema>();
  const seriesEntries = await fs.readdir(schemasDir, { withFileTypes: true });
  for (const entry of seriesEntries) {
    if (!entry.isDirectory() || !/^\d{3}$/.test(entry.name)) continue;
    const seriesDir = path.join(schemasDir, entry.name);
    const files = await fs.readdir(seriesDir);
    for (const file of files) {
      if (!file.endsWith('.schema.json')) continue;
      const raw = await fs.readFile(path.join(seriesDir, file), 'utf8');
      const schema = JSON.parse(raw) as JSONSchema & { $id?: string };
      if (typeof schema.$id === 'string') {
        map.set(schema.$id, schema);
      }
    }
  }
  return map;
}

async function compileOne(
  target: SchemaTarget,
  schemaIndex: Map<string, JSONSchema>,
): Promise<string> {
  const raw = await fs.readFile(target.filePath, 'utf8');
  const schema = JSON.parse(raw) as JSONSchema;
  void schemaIndex;
  // json-schema-to-typescript uses `title` as the root type name when present.
  const rootSchema: JSONSchema = { ...schema, title: target.typeName };

  const localResolver = {
    order: 1,
    canRead: (file: { url: string }) => /^https?:\/\/act-spec\.org\//.test(file.url),
    read: (file: { url: string }) => {
      const hit = schemaIndex.get(file.url);
      if (!hit) throw new Error(`unknown $id for local resolver: ${file.url}`);
      return JSON.stringify(hit);
    },
  };

  const ts = await compile(rootSchema, target.typeName, {
    bannerComment:
      `/**\n` +
      ` * AUTO-GENERATED — do not edit. Source: schemas/${target.series}/${target.name}.schema.json.\n` +
      ` * Regenerate via \`pnpm -F @act-spec/core codegen\`.\n` +
      ` */`,
    additionalProperties: true,
    style: { singleQuote: true, semi: true, printWidth: 100 },
    declareExternallyReferenced: true,
    enableConstEnums: false,
    $refOptions: {
      resolve: {
        actSpec: localResolver,
      },
    },
  });
  return ts;
}

async function main(): Promise<void> {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const targets = await discover();
  if (targets.length === 0) {
    throw new Error(`No schemas found under ${schemasDir}`);
  }
  const schemaIndex = await buildLocalSchemaIndex();

  const indexLines: string[] = [
    `// AUTO-GENERATED — barrel for json-schema-to-typescript output.`,
    `// Regenerate via \`pnpm -F @act-spec/core codegen\`.`,
    ``,
  ];

  for (const target of targets) {
    const ts = await compileOne(target, schemaIndex);
    const seriesDir = path.join(outDir, target.series);
    await fs.mkdir(seriesDir, { recursive: true });
    const outFile = path.join(seriesDir, `${target.name}.ts`);
    await fs.writeFile(outFile, ts, 'utf8');
    // Namespaced re-export prevents cross-file name collisions (e.g.,
    // `ContentBlock` defined in both `100/node.ts` and the block schemas).
    const ns = `${target.typeName}Schema`;
    indexLines.push(`export * as ${ns} from './${target.series}/${target.name}.js';`);
    // eslint-disable-next-line no-console
    console.log(`  generated  ${path.relative(repoRoot, outFile)}`);
  }

  await fs.writeFile(path.join(outDir, 'index.ts'), indexLines.join('\n') + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log(`\n  ${targets.length} schema(s) processed -> ${path.relative(repoRoot, outDir)}`);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
