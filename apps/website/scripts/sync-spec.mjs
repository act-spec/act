// Mirror `../../spec/v0.2/` into `src/content/docs/spec/v0.2/`.
//
// The spec lives canonically under `spec/v0.2/` at the repo root so it can
// be edited without dragging the website build into the loop. Starlight
// requires its content collection under `src/content/docs/`. This script
// copies the spec into the collection, prefixing each markdown file with
// the Starlight-required frontmatter (`title`, optional `description`),
// rewriting cross-links from spec-relative (`./node.md`) to
// site-relative (`/spec/v0.2/wire-format/node`), and stripping the
// pre-existing spec frontmatter so Starlight does not double-render it.
//
// The mirrored directory is gitignored (see `.gitignore`).
//
// Usage:
//   node scripts/sync-spec.mjs           # run once
//
// Imported by `scripts/sync-spec-integration.mjs` so Astro re-runs the
// sync on `astro:config:setup` (covers both `dev` and `build`).
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(here, '..');
const repoRoot = path.resolve(websiteRoot, '..', '..');

const SOURCE = path.join(repoRoot, 'spec', 'v0.2');
const DEST = path.join(websiteRoot, 'src', 'content', 'docs', 'spec', 'v0.2');

/**
 * Parse a YAML-style frontmatter block. Light-touch — only handles
 * `key: value` pairs, no nested objects. The spec docs all use this
 * shape (see `spec/v0.2/index.md`).
 */
function parseFrontmatter(src) {
  if (!src.startsWith('---\n')) return { frontmatter: {}, body: src };
  const end = src.indexOf('\n---\n', 4);
  if (end === -1) return { frontmatter: {}, body: src };
  const block = src.slice(4, end);
  const body = src.slice(end + 5);
  const fm = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { frontmatter: fm, body };
}

/**
 * Convert spec frontmatter into Starlight-compatible frontmatter.
 *
 * Starlight requires `title`. The spec docs already carry `title`. We
 * also surface `description` derived from the first paragraph of the
 * body when the spec doesn't declare one.
 */
function rewriteFrontmatter(fm, body) {
  const title = fm.title ?? 'Untitled';
  const out = { title };
  if (fm.description) out.description = fm.description;
  if (fm._slugOverride) out.slug = fm._slugOverride;
  // Note: spec frontmatter's `last-updated` is intentionally not forwarded to
  // Starlight's `lastUpdated` — Starlight's schema requires Date|boolean, and
  // git history is the authoritative timestamp once the spec ships.
  // We do NOT set a `slug` here. Astro slugifies `v0.2` to `v02` in the URL,
  // which is intentional — dots in URL path segments are legal but harm
  // copy-paste ergonomics in some contexts. Internal links resolved by
  // `rewriteLinks` use the same `/spec/v0.2/` form regardless because we
  // override the slug per file via `_path.slug`-style metadata below.
  const lines = ['---'];
  for (const [k, v] of Object.entries(out)) {
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push('---', '', body.trimStart());
  return lines.join('\n');
}

/**
 * Rewrite intra-spec links from `./foo.md` and `../wire-format/foo.md`
 * to Starlight-style absolute URLs under `/spec/v0.2/`.
 *
 * The spec's `index.md` and `why-act.md` link to siblings as relative
 * paths; Starlight needs those resolved relative to the site root.
 */
function rewriteLinks(body, sourcePath) {
  // Compute the spec-relative directory of the current file (e.g.
  // `wire-format/`) so `./foo.md` and `../bar.md` resolve correctly.
  const relDir = path.dirname(path.relative(SOURCE, sourcePath));
  return body.replace(/\]\(([^)]+\.md)([#?][^)]*)?\)/g, (_match, target, hash) => {
    if (/^https?:/.test(target)) return `](${target}${hash ?? ''})`;
    if (target.startsWith('/')) return `](${target}${hash ?? ''})`;
    const abs = path.posix.normalize(path.posix.join(relDir, target));
    const stripped = abs.replace(/\.md$/, '');
    return `](/spec/v0.2/${stripped}${hash ?? ''})`;
  });
}

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function walk(dir) {
  const out = [];
  async function visit(d) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await visit(p);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
    }
  }
  await visit(dir);
  return out;
}

export async function syncSpec({ silent = false } = {}) {
  await rmrf(DEST);
  await fs.mkdir(DEST, { recursive: true });

  const files = await walk(SOURCE);
  for (const src of files) {
    const rel = path.relative(SOURCE, src);
    const dst = path.join(DEST, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    const raw = await fs.readFile(src, 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    // Compute the desired URL slug for this file. Astro's default
    // slugifier turns `v0.2` into `v02`; we want `v0.2` preserved in the
    // public URL. Stash an explicit `slug:` frontmatter so Starlight uses
    // it verbatim. Slugs are root-relative (no leading slash).
    const relSlug = path
      .relative(SOURCE, src)
      .replace(/\\/g, '/')
      .replace(/\.md$/, '')
      .replace(/\/index$/, '');
    const explicitSlug = `spec/v0.2/${relSlug}`.replace(/\/$/, '');
    const rewritten = rewriteFrontmatter(
      { ...frontmatter, _slugOverride: explicitSlug },
      rewriteLinks(body, src),
    );
    await fs.writeFile(dst, rewritten, 'utf8');
  }
  if (!silent) {
    console.log(`[sync-spec] mirrored ${files.length} files: ${SOURCE} → ${DEST}`);
  }
  return files.length;
}

// Direct invocation: `node scripts/sync-spec.mjs`.
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  syncSpec().catch((err) => {
    console.error('[sync-spec] failed:', err);
    process.exit(1);
  });
}
