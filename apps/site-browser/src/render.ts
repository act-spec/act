// SPDX-License-Identifier: Apache-2.0
/**
 * Pure HTML rendering helpers. Returns escaped strings; the caller assigns
 * to `innerHTML`. Side-effect-free so subagent #4 can unit-test the output.
 *
 * Markdown is rendered via `marked` for `prose` blocks. The markdown body
 * is trusted: it comes from the user's own ACT site (the same site they
 * just chose to inspect), and the CORS notice already warns operators
 * about external content.
 */
import { marked } from 'marked';
import type { Gap, Warning } from '@act-spec/validator';
import type {
  HtmlFetchOutcome,
  IndexEntry,
  ManifestEnvelope,
  NodeEnvelope,
  SiteError,
  SiteHandle,
} from './fetch.js';

marked.setOptions({ gfm: true, breaks: false });

function renderGapList(gaps: readonly Gap[]): string {
  if (gaps.length === 0) {
    return '<p class="ok">No gaps — the envelope conforms.</p>';
  }
  const items = gaps
    .map(
      (g) => `
        <li class="finding finding--gap finding--${esc(g.level)}">
          <span class="finding__band">${esc(g.level)}</span>
          <span class="finding__msg">${esc(g.missing)}</span>
        </li>`,
    )
    .join('');
  return `<ul class="findings">${items}</ul>`;
}

function renderWarningList(warnings: readonly Warning[]): string {
  if (warnings.length === 0) return '';
  const items = warnings
    .map(
      (w) => `
        <li class="finding finding--warn finding--${esc(w.level)}">
          <span class="finding__band">${esc(w.level)}</span>
          <span class="finding__code">${esc(w.code)}</span>
          <span class="finding__msg">${esc(w.message)}</span>
        </li>`,
    )
    .join('');
  return `<ul class="findings">${items}</ul>`;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderInitial(): string {
  // The example URL is wired through delegation: clicking sets the input
  // value but does not auto-submit, so the user still presses Walk.
  const exampleUrl = 'http://localhost:4321';
  return `
    <section class="result">
      <header class="result__header">
        <h2>Browse an ACT site</h2>
        <p class="muted">
          Paste a manifest URL (or a bare origin) above and press Walk. You can
          also drag a local <code>act.json</code> file into the page.
        </p>
      </header>
      <p>
        Try a local example:
        <button type="button" class="link" data-action="set-url" data-url="${esc(exampleUrl)}">${esc(exampleUrl)}</button>
        (after running
        <code>pnpm -F @act-spec/example-astro-docs build &amp;&amp; pnpm -F @act-spec/example-astro-docs preview</code>).
      </p>
      <p class="muted">
        Or drop a <code>.json</code> envelope file anywhere on the page to inspect it offline.
      </p>
    </section>
  `;
}

export function renderLoading(msg: string): string {
  return `<p class="loading">${esc(msg)}</p>`;
}

export function renderErrors(errors: readonly SiteError[]): string {
  if (errors.length === 0) return '';
  const cors = errors.some((e) => e.cors === true);
  const items = errors
    .map(
      (e) => `
        <li class="finding finding--warn">
          <span class="finding__band">${esc(e.scope)}</span>
          <span class="finding__msg">${esc(e.message)}</span>
        </li>`,
    )
    .join('');
  const banner = cors
    ? `<aside class="cors-warning" role="alert">
         <strong>CORS blocked the fetch.</strong>
         The site browser cannot bypass CORS; paste the manifest as JSON via
         drag-and-drop, or run the static target with a permissive
         <code>Access-Control-Allow-Origin</code> response.
       </aside>`
    : '';
  return `
    <section class="result result--error" role="alert">
      <h2>Could not load site</h2>
      ${banner}
      <ul class="findings">${items}</ul>
    </section>
  `;
}

export interface ManifestHeaderOptions {
  manifestGaps?: readonly Gap[];
  manifestWarnings?: readonly Warning[];
  /** Three-line payload meter input. Omit to hide the meter entirely. */
  meter?: PayloadMeterInput;
}

export interface PayloadMeterInput {
  /** Cumulative bytes the agent traverses to reach the selected node:
   * manifest + every subtree on the walk path + the selected node itself. */
  walkBytes: number;
  /** Gzipped wire bytes for the same walk — the figure a CDN with
   * `Content-Encoding: gzip` would actually ship. Omit when CompressionStream
   * isn't available or any fetch on the walk lacks a measurement. */
  walkGzipBytes?: number;
  /** Human label like "manifest + 1 subtree + node" or just "manifest". */
  walkLabel: string;
  /** Sum of HTML bytes for every node on the walk path that has
   * `source.human_url`. `undefined` means the operator hasn't opted in yet
   * (lazy fetch); a numeric value is the raw byte sum. */
  htmlBytes?: number;
  /** Gzipped HTML wire bytes — sum of gzipped page sizes. Omit when at
   * least one page lacks a gzip measurement (the raw line marks ≥ via
   * htmlMeasured). */
  htmlGzipBytes?: number | null;
  /** Number of pages successfully measured / total pages on walk path. */
  htmlMeasured?: { ok: number; total: number };
  /** Bytes of `index.json` once the operator opts into the diagnostic
   * "Show full index" view; `undefined` means the index is unloaded. */
  indexBytes?: number;
  /** Gzipped wire bytes for the loaded index. Omit when CompressionStream
   * is unavailable. */
  indexGzipBytes?: number;
  /** Number of entries in the loaded index (rendered when `indexBytes` set). */
  indexEntryCount?: number;
}

export function renderManifestHeader(
  manifest: ManifestEnvelope,
  manifestUrl: string,
  options: ManifestHeaderOptions = {},
): string {
  const {
    manifestGaps = [],
    manifestWarnings = [],
    meter,
  } = options;
  const caps = manifest.capabilities ?? {};
  const capChips = Object.entries(caps)
    .filter(([, v]) => v === true || (typeof v === 'object' && v !== null))
    .map(([k]) => `<code>${esc(k)}</code>`)
    .join(' ');
  const locales = Array.isArray((manifest as { locales?: unknown }).locales)
    ? ((manifest as { locales?: unknown[] }).locales as unknown[]).map((l) => esc(String(l))).join(', ')
    : (manifest.site.locale ? esc(manifest.site.locale) : '<span class="muted">—</span>');
  const description = typeof manifest.site.description === 'string'
    ? `<p class="muted">${esc(manifest.site.description)}</p>`
    : '';
  const gapCount = manifestGaps.length;
  const verdict = gapCount === 0
    ? `<span class="verdict verdict--ok">PASS</span>`
    : `<span class="verdict verdict--fail">${gapCount} gap${gapCount === 1 ? '' : 's'}</span>`;
  const warnCount = manifestWarnings.length;
  const gapDetails = (gapCount > 0 || warnCount > 0)
    ? `<details class="manifest-findings">
         <summary class="muted">Validator findings (${gapCount} gap${gapCount === 1 ? '' : 's'}${warnCount > 0 ? `, ${warnCount} warning${warnCount === 1 ? '' : 's'}` : ''})</summary>
         ${gapCount > 0 ? renderGapList(manifestGaps) : ''}
         ${warnCount > 0 ? renderWarningList(manifestWarnings) : ''}
       </details>`
    : '';
  const payloadStrip = meter !== undefined ? renderPayloadMeter(meter) : '';
  return `
    <header class="result__header">
      <h2>${esc(manifest.site.name)} ${verdict}</h2>
      ${payloadStrip}
      ${description}
      <details class="manifest-meta">
        <summary><span class="manifest-meta__label">Manifest details</span> <span class="muted manifest-meta__url"><code>${esc(manifestUrl)}</code></span></summary>
        <dl class="report-meta">
          <dt>act_version</dt><dd><code>${esc(manifest.act_version)}</code></dd>
          <dt>Conformance</dt><dd>${esc(manifest.conformance.level)} / ${esc(manifest.delivery)}</dd>
          <dt>Locales</dt><dd>${locales}</dd>
          <dt>Capabilities</dt><dd>${capChips || '<span class="muted">none advertised</span>'}</dd>
          <dt>index_url</dt><dd><code>${esc(manifest.index_url)}</code></dd>
          <dt>node_url_template</dt><dd><code>${esc(manifest.node_url_template)}</code></dd>
          ${typeof manifest.subtree_url_template === 'string'
            ? `<dt>subtree_url_template</dt><dd><code>${esc(manifest.subtree_url_template)}</code></dd>`
            : ''}
          ${typeof manifest.search_url_template === 'string'
            ? `<dt>search_url_template</dt><dd><code>${esc(manifest.search_url_template)}</code></dd>`
            : ''}
        </dl>
      </details>
      ${gapDetails}
    </header>
  `;
}

/** Format a UTF-8 byte count as a human-friendly string (B / KB / MB).
 * Uses 1024-based units so it lines up with how OS file managers display
 * payload sizes; the numbers here are usually in the KB range. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(2) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
}

/** Rough token estimate from byte count. We use ~4 UTF-8 bytes per token,
 * which is the standard back-of-envelope for English text under BPE
 * tokenisers (cl100k / o200k). It's a ballpark — the goal is to give the
 * operator an order-of-magnitude sense of how much context an agent would
 * spend pulling this view. */
export function estimateTokens(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.max(1, Math.round(bytes / 4));
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  const k = tokens / 1000;
  return `${k < 10 ? k.toFixed(2) : k.toFixed(1)}k`;
}

function renderMeterRow(
  label: string,
  bytes: number,
  scope: string,
  opts: {
    approx?: boolean;
    tooltip?: string;
    gzipBytes?: number;
    /** When set, render savings/cost badges next to each figure comparing
     * the row to this baseline. Used on the ACT-walk row when the HTML
     * estimate is available. */
    comparedTo?: { bytes: number; gzipBytes?: number };
  } = {},
): string {
  const tokens = estimateTokens(bytes);
  const prefix = opts.approx ? '≥ ' : '';
  const tip = opts.tooltip ? ` title="${esc(opts.tooltip)}"` : '';
  const cmp = opts.comparedTo;
  const bytesDelta = cmp ? renderDeltaBadge(bytes, cmp.bytes, 'raw bytes') : '';
  const gzipDelta = cmp && typeof cmp.gzipBytes === 'number' && typeof opts.gzipBytes === 'number'
    ? renderDeltaBadge(opts.gzipBytes, cmp.gzipBytes, 'gzipped bytes')
    : '';
  const tokenDelta = cmp ? renderDeltaBadge(estimateTokens(bytes), estimateTokens(cmp.bytes), 'tokens') : '';
  const gzipChip = typeof opts.gzipBytes === 'number'
    ? `<span class="payload-meter__gzip" title="Wire bytes after gzip — what a CDN with Content-Encoding: gzip ships.">${esc(prefix)}${esc(formatBytes(opts.gzipBytes))} gz${gzipDelta}</span>`
    : '';
  return `
    <div class="payload-meter__row" data-meter-row="${esc(label.toLowerCase().replace(/\s+/g, '-'))}"${tip}>
      <span class="payload-meter__label">${esc(label)}</span>
      <span class="payload-meter__bytes">${esc(prefix)}${esc(formatBytes(bytes))}${bytesDelta}</span>
      ${gzipChip}
      <span class="payload-meter__sep">·</span>
      <span class="payload-meter__tokens">${esc(prefix)}~${esc(formatTokenCount(tokens))} tokens${tokenDelta}</span>
      <span class="payload-meter__scope muted">${esc(scope)}</span>
    </div>
  `;
}

/** Render a savings/cost badge: green ↓ when `mine` is smaller than the
 * baseline, red ↑ when larger. The badge sits inline with the figure it
 * annotates so the comparison reads naturally next to the number. */
function renderDeltaBadge(mine: number, baseline: number, scopeLabel: string): string {
  if (!Number.isFinite(mine) || !Number.isFinite(baseline) || baseline <= 0) return '';
  const pct = Math.round((1 - mine / baseline) * 100);
  if (pct === 0) return '';
  const direction = pct > 0 ? 'save' : 'cost';
  const arrow = pct > 0 ? '↓' : '↑';
  const magnitude = Math.abs(pct);
  const label = pct > 0
    ? `${magnitude}% smaller in ${scopeLabel} than HTML walk`
    : `${magnitude}% larger in ${scopeLabel} than HTML walk`;
  return `<span class="payload-meter__delta payload-meter__delta--${direction}" title="${esc(label)}">${arrow} ${magnitude}%</span>`;
}

function renderMeterPlaceholder(label: string, scope: string, action?: { id: string; label: string }, tooltip?: string): string {
  const tip = tooltip ? ` title="${esc(tooltip)}"` : '';
  const cta = action !== undefined
    ? `<button type="button" class="link payload-meter__cta" data-action="${esc(action.id)}">${esc(action.label)}</button>`
    : '';
  return `
    <div class="payload-meter__row payload-meter__row--placeholder" data-meter-row="${esc(label.toLowerCase().replace(/\s+/g, '-'))}"${tip}>
      <span class="payload-meter__label">${esc(label)}</span>
      <span class="payload-meter__bytes muted">—</span>
      <span class="payload-meter__sep muted">·</span>
      <span class="payload-meter__tokens muted">—</span>
      <span class="payload-meter__scope muted">${esc(scope)}</span>
      ${cta}
    </div>
  `;
}

export function renderPayloadMeter(input: PayloadMeterInput): string {
  // When HTML estimate is on, the ACT-walk row shows savings/cost badges
  // next to each figure comparing it to the HTML equivalent.
  const compareToHtml = typeof input.htmlBytes === 'number' && input.htmlBytes > 0
    ? {
      bytes: input.htmlBytes,
      ...(typeof input.htmlGzipBytes === 'number' ? { gzipBytes: input.htmlGzipBytes } : {}),
    }
    : undefined;
  const walkRow = renderMeterRow(
    'ACT walk',
    input.walkBytes,
    input.walkLabel,
    {
      tooltip:
        'What an agent that respects subtrees actually fetches to reach the selected node: manifest + each subtree on the path from root to selected + the selected node itself. The "gz" figure is what a CDN with gzip enabled would ship over the wire.',
      ...(typeof input.walkGzipBytes === 'number' ? { gzipBytes: input.walkGzipBytes } : {}),
      ...(compareToHtml !== undefined ? { comparedTo: compareToHtml } : {}),
    },
  );

  let htmlRow: string;
  if (input.htmlBytes === undefined) {
    htmlRow = renderMeterPlaceholder(
      'HTML equivalent',
      'walk-path pages',
      { id: 'estimate-html', label: 'Estimate HTML cost' },
      'For each node on the ACT walk path with source.human_url, fetches the rendered HTML page and sums the bytes. Lower-bound estimate (no CSS/JS/images counted).',
    );
  } else {
    const measured = input.htmlMeasured ?? { ok: 0, total: 0 };
    const scope = `${measured.ok} of ${measured.total} HTML page${measured.total === 1 ? '' : 's'}`;
    const approx = measured.ok < measured.total;
    const bytes = input.htmlBytes ?? 0;
    const tooltip = approx
      ? `${measured.total - measured.ok} page${measured.total - measured.ok === 1 ? '' : 's'} could not be measured (CORS, 4xx/5xx, or no source.human_url). Figure is a lower bound. The "gz" figure is what a CDN with gzip enabled would ship.`
      : 'Sum of bytes for the rendered HTML pages reached via source.human_url for every node on the walk path. The "gz" figure is what a CDN with gzip enabled would ship.';
    htmlRow = renderMeterRow('HTML equivalent', bytes, scope, {
      approx,
      tooltip,
      ...(typeof input.htmlGzipBytes === 'number' ? { gzipBytes: input.htmlGzipBytes } : {}),
    });
  }

  let indexRow: string;
  if (input.indexBytes === undefined) {
    indexRow = renderMeterPlaceholder(
      'Full index',
      'flat enumerate (off)',
      { id: 'show-full-index', label: 'Show full index' },
      'The flat index.json lists every node in the corpus. Subtree-walking agents never load it, but it remains available for full enumeration. Click to fetch and add its bytes here.',
    );
  } else {
    const count = input.indexEntryCount ?? 0;
    indexRow = renderMeterRow(
      'Full index',
      input.indexBytes,
      `${count} entr${count === 1 ? 'y' : 'ies'}`,
      {
        tooltip:
          'Bytes of the lazily-fetched index.json — the flat brute-force enumerate path. Compare against the ACT-walk row above to see what subtree navigation saves. The "gz" figure is what a CDN with gzip enabled would ship.',
        ...(typeof input.indexGzipBytes === 'number' ? { gzipBytes: input.indexGzipBytes } : {}),
      },
    );
  }

  return `
    <aside class="payload-meter payload-meter--multi" aria-label="Walk-path payload comparison">
      ${walkRow}
      ${htmlRow}
      ${indexRow}
    </aside>
  `;
}

/** Minimal per-node record used by the progressive-walk tree. */
export interface TreeNode {
  id: string;
  type: string;
  title: string;
  parent?: string | null;
  children?: readonly string[];
  /** Whether the node has been fetched (has full envelope) vs. discovered
   * only via a parent's `children[]`. Affects the row's "stub" styling. */
  loaded: boolean;
  /** Whether the node has had its descendants explicitly expanded via a
   * fetch. Inner nodes that are loaded but not expanded are clickable but
   * don't render their children inline. */
  expanded: boolean;
  source?: { human_url?: string };
}

interface TreeRowOut {
  node: TreeNode;
  depth: number;
}

function nodeLocale(node: TreeNode | NodeEnvelope): string | null {
  const meta = (node as { metadata?: unknown }).metadata;
  if (meta && typeof meta === 'object') {
    const locale = (meta as { locale?: unknown }).locale;
    if (typeof locale === 'string' && locale.length > 0) return locale;
  }
  return null;
}

function buildProgressiveRows(
  nodes: ReadonlyMap<string, TreeNode>,
  rootId: string,
  expandedIds: ReadonlySet<string>,
): TreeRowOut[] {
  const rows: TreeRowOut[] = [];
  const seen = new Set<string>();
  // Track ids that are claimed by some other node's `children[]` so we don't
  // hoist them up as bare "orphans" when their parent is collapsed.
  const claimed = new Set<string>();
  for (const node of nodes.values()) {
    for (const cid of node.children ?? []) claimed.add(cid);
  }
  function visit(id: string, depth: number): void {
    if (seen.has(id)) return;
    seen.add(id);
    const node = nodes.get(id);
    if (!node) return;
    rows.push({ node, depth });
    if (!expandedIds.has(id)) return;
    const childIds = node.children !== undefined && node.children.length > 0
      ? [...node.children].sort((a, b) => a.localeCompare(b))
      : [];
    for (const cid of childIds) visit(cid, depth + 1);
  }
  visit(rootId, 0);
  // Append true orphans only — nodes the operator deep-linked to that no
  // visited (or claimed-by-anyone) node lists as a child. Collapsed-parent
  // children stay hidden until the operator expands them.
  for (const [id, node] of nodes.entries()) {
    if (seen.has(id)) continue;
    if (claimed.has(id)) continue;
    rows.push({ node, depth: 0 });
    seen.add(id);
  }
  return rows;
}

export interface RenderTreeOptions {
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  gapCounts?: ReadonlyMap<string, number>;
  walkPath?: ReadonlyArray<string>;
}

/** Render the progressive-walk tree from the cached node map. Stub rows
 * (children discovered via parent's children[] but not yet fetched) are
 * shown collapsed and clickable. Loaded inner nodes can be expanded. */
export function renderProgressiveTree(
  nodes: ReadonlyMap<string, TreeNode>,
  rootId: string,
  options: RenderTreeOptions,
): string {
  if (nodes.size === 0) {
    return '<p class="muted">Manifest loaded but no nodes discovered yet.</p>';
  }
  const { selectedId, expandedIds, gapCounts = new Map<string, number>(), walkPath } = options;
  const walkSet = new Set(walkPath ?? []);
  const rows = buildProgressiveRows(nodes, rootId, expandedIds);
  const items = rows
    .map(({ node, depth }) => {
      const isSelected = selectedId === node.id;
      const onWalk = walkSet.has(node.id);
      const isStub = !node.loaded;
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      const expanded = expandedIds.has(node.id);
      const indent = `padding-left: ${0.5 + depth * 1}rem`;
      const locale = nodeLocale(node);
      const localeChip = locale !== null
        ? `<span class="tree__chip chip chip--mute" title="locale">${esc(locale)}</span>`
        : '';
      const gapCount = gapCounts.get(node.id) ?? 0;
      const gapChip = gapCount > 0
        ? `<span class="tree__chip chip chip--warn" title="${gapCount} validator gap${gapCount === 1 ? '' : 's'}">! ${gapCount}</span>`
        : '';
      const stubChip = isStub
        ? '<span class="tree__chip chip chip--mute" title="Discovered via parent\'s children[]; click to fetch">stub</span>'
        : '';
      const expandChip = hasChildren
        ? `<span class="tree__chip chip chip--mute" title="${expanded ? 'Expanded' : 'Collapsed; click to expand'}">${expanded ? '▾' : '▸'} ${(node.children ?? []).length}</span>`
        : '';
      const walkClass = onWalk ? ' tree__item--on-walk' : '';
      return `
        <li class="tree__item${isSelected ? ' tree__item--selected' : ''}${walkClass}"
            role="option"
            aria-selected="${isSelected ? 'true' : 'false'}"
            data-node-id="${esc(node.id)}"
            style="${indent}">
          <span class="tree__title">${esc(node.title)}${localeChip}${gapChip}${stubChip}${expandChip}</span>
          <span class="tree__type-chip">${esc(node.type)}</span>
          <span class="tree__id">${esc(node.id)}</span>
        </li>`;
    })
    .join('');
  return `<ul class="tree" role="listbox" aria-label="Site nodes">${items}</ul>`;
}

/** Diagnostic flat-index rendering. Used only when the operator opts into
 * the "Show full index" affordance. */
export function renderIndexList(
  entries: readonly IndexEntry[],
  selectedId: string | null,
): string {
  if (entries.length === 0) return '<p class="muted">Index is empty.</p>';
  const items = entries
    .map((entry) => {
      const isSelected = selectedId === entry.id;
      return `
        <li class="tree__item${isSelected ? ' tree__item--selected' : ''}"
            role="option"
            aria-selected="${isSelected ? 'true' : 'false'}"
            data-node-id="${esc(entry.id)}">
          <span class="tree__title">${esc(entry.title)}</span>
          <span class="tree__type-chip">${esc(entry.type)}</span>
          <span class="tree__id">${esc(entry.id)}</span>
        </li>`;
    })
    .join('');
  return `<ul class="tree tree--flat" role="listbox" aria-label="Flat index">${items}</ul>`;
}

interface ContentBlock {
  type: string;
  format?: string;
  text?: string;
  level?: string;
  language?: string;
  payload?: unknown;
  [k: string]: unknown;
}

function renderProseBlock(block: ContentBlock, idx: number): string {
  const text = typeof block.text === 'string' ? block.text : '';
  const html = marked.parse(text, { async: false });
  return `
    <section class="block block--prose">
      <header class="block__head">
        <span class="block__kind">prose</span>
        <span class="block__idx">#${idx}</span>
      </header>
      <div class="block__body">${html}</div>
    </section>
  `;
}

function renderCalloutBlock(block: ContentBlock, idx: number): string {
  const level = typeof block.level === 'string' ? block.level : 'info';
  const text = typeof block.text === 'string' ? block.text : '';
  const html = marked.parse(text, { async: false });
  return `
    <section class="block block--callout block--callout--${esc(level)}">
      <header class="block__head">
        <span class="block__kind">callout / ${esc(level)}</span>
        <span class="block__idx">#${idx}</span>
      </header>
      <div class="block__body">${html}</div>
    </section>
  `;
}

function renderCodeBlock(block: ContentBlock, idx: number): string {
  const lang = typeof block.language === 'string' ? block.language : '';
  const text = typeof block.text === 'string' ? block.text : '';
  return `
    <section class="block block--code">
      <header class="block__head">
        <span class="block__kind">code${lang ? ' / ' + esc(lang) : ''}</span>
        <span class="block__idx">#${idx}</span>
      </header>
      <pre><code>${esc(text)}</code></pre>
    </section>
  `;
}

function renderDataBlock(block: ContentBlock, idx: number): string {
  const payload = block['payload'] !== undefined ? block['payload'] : block;
  const json = JSON.stringify(payload, null, 2);
  return `
    <section class="block block--data">
      <header class="block__head">
        <span class="block__kind">data</span>
        <span class="block__idx">#${idx}</span>
      </header>
      <pre class="json-block"><code>${esc(json)}</code></pre>
    </section>
  `;
}

function renderGenericBlock(block: ContentBlock, idx: number): string {
  const kind = typeof block.type === 'string' ? block.type : 'block';
  const json = JSON.stringify(block, null, 2);
  const cls = `block block--${esc(kind.replace(/[^a-z0-9_-]/gi, '-'))}`;
  return `
    <section class="${cls}">
      <header class="block__head">
        <span class="block__kind">${esc(kind)}</span>
        <span class="block__idx">#${idx}</span>
      </header>
      <details>
        <summary class="muted">Show payload</summary>
        <pre class="json-block"><code>${esc(json)}</code></pre>
      </details>
    </section>
  `;
}

function renderBlock(block: ContentBlock, idx: number): string {
  switch (block.type) {
    case 'prose':
      return renderProseBlock(block, idx);
    case 'callout':
      return renderCalloutBlock(block, idx);
    case 'code':
      return renderCodeBlock(block, idx);
    case 'data':
      return renderDataBlock(block, idx);
    default:
      return renderGenericBlock(block, idx);
  }
}

interface NodeMetadata {
  locale?: unknown;
  translation_status?: unknown;
  source?: unknown;
}

interface RelatedEntry {
  id?: unknown;
  relation?: unknown;
}

function renderProvenance(metadata: NodeMetadata | undefined): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const chips: string[] = [];
  if (typeof metadata.locale === 'string' && metadata.locale.length > 0) {
    chips.push(`<span class="chip chip--mute">locale: ${esc(metadata.locale)}</span>`);
  }
  if (typeof metadata.translation_status === 'string' && metadata.translation_status.length > 0) {
    const cls = metadata.translation_status === 'fallback' ? 'chip chip--warn' : 'chip chip--mute';
    chips.push(`<span class="${cls}">translation: ${esc(metadata.translation_status)}</span>`);
  }
  const source = metadata.source;
  if (source && typeof source === 'object') {
    const src = source as { adapter?: unknown; source_id?: unknown; source_path?: unknown };
    if (typeof src.adapter === 'string' && src.adapter.length > 0) {
      chips.push(`<span class="chip chip--mute">adapter: ${esc(src.adapter)}</span>`);
    }
    if (typeof src.source_id === 'string' && src.source_id.length > 0) {
      chips.push(`<span class="chip chip--mute">source: ${esc(src.source_id)}</span>`);
    }
  }
  if (chips.length === 0) return '';
  return `<div class="provenance" aria-label="Provenance">${chips.join('')}</div>`;
}

function renderRelatedSection(related: unknown): string {
  if (!Array.isArray(related) || related.length === 0) return '';
  const chips = (related as RelatedEntry[])
    .filter((r) => typeof r.id === 'string' && (r.id).length > 0)
    .map((r) => {
      const id = r.id as string;
      const relation = typeof r.relation === 'string' ? r.relation : 'related';
      return `<button type="button" class="chip chip--accent" data-action="goto-node" data-id="${esc(id)}">${esc(relation)}: ${esc(id)}</button>`;
    })
    .join('');
  if (chips.length === 0) return '';
  return `
    <section class="related">
      <h3>Related</h3>
      <div class="related__chips">${chips}</div>
    </section>
  `;
}

function renderNodeGapStrip(gaps: readonly Gap[], warnings: readonly Warning[]): string {
  const gapCount = gaps.length;
  const warnCount = warnings.length;
  if (gapCount === 0 && warnCount === 0) return '';
  const verdict = gapCount === 0
    ? `<span class="verdict verdict--ok">PASS</span>`
    : `<span class="verdict verdict--fail">${gapCount} gap${gapCount === 1 ? '' : 's'}</span>`;
  return `
    <details class="node-findings" open>
      <summary>Validator: ${verdict}${warnCount > 0 ? ` <span class="muted">(${warnCount} warning${warnCount === 1 ? '' : 's'})</span>` : ''}</summary>
      ${gapCount > 0 ? renderGapList(gaps) : ''}
      ${warnCount > 0 ? renderWarningList(warnings) : ''}
    </details>
  `;
}

export function renderNodeDetail(
  node: unknown,
  gaps: readonly Gap[] = [],
  warnings: readonly Warning[] = [],
): string {
  if (!node || typeof node !== 'object') {
    return '<p class="muted">Select a node from the tree to view its content.</p>';
  }
  const n = node as {
    id?: string;
    type?: string;
    title?: string;
    summary?: string;
    content?: unknown;
    tags?: string[];
    parent?: string | null;
    etag?: string;
    metadata?: NodeMetadata;
    related?: unknown;
  };
  const blocks = Array.isArray(n.content) ? (n.content as ContentBlock[]) : [];
  const blocksHtml = blocks.length > 0
    ? blocks.map((b, i) => renderBlock(b, i)).join('')
    : '<p class="muted">No content blocks on this node.</p>';
  const tags = Array.isArray(n.tags) && n.tags.length > 0
    ? `<dt>Tags</dt><dd>${n.tags.map((t) => `<code>${esc(t)}</code>`).join(' ')}</dd>`
    : '';
  return `
    <article class="detail-pane">
      ${renderNodeGapStrip(gaps, warnings)}
      <header>
        <h2>${esc(n.title ?? n.id ?? '<untitled>')}</h2>
        <p class="muted"><code>${esc(n.id ?? '')}</code> · ${esc(n.type ?? '')}</p>
        ${typeof n.summary === 'string' ? `<p>${esc(n.summary)}</p>` : ''}
        ${renderProvenance(n.metadata)}
        <dl class="report-meta">
          ${typeof n.parent === 'string' ? `<dt>Parent</dt><dd><code>${esc(n.parent)}</code></dd>` : ''}
          ${typeof n.etag === 'string' ? `<dt>etag</dt><dd><code>${esc(n.etag)}</code></dd>` : ''}
          ${tags}
        </dl>
      </header>
      <div class="blocks">${blocksHtml}</div>
      ${renderRelatedSection(n.related)}
    </article>
  `;
}

export interface SiteViewInput {
  handle: SiteHandle;
  selectedId: string | null;
  detailHtml: string;
  gapCounts?: ReadonlyMap<string, number>;
  /** Progressive-walk node cache (populated as the operator navigates). */
  nodes: ReadonlyMap<string, TreeNode>;
  expandedIds: ReadonlySet<string>;
  walkPath: ReadonlyArray<string>;
  /** Pre-computed payload meter input. */
  meter: PayloadMeterInput;
  /** When set, the operator has opted into the diagnostic flat-index view. */
  flatIndex?: {
    entries: readonly IndexEntry[];
    gaps: readonly Gap[];
    warnings: readonly Warning[];
  } | undefined;
  /** Subtree-related fetch errors to surface above the tree. */
  walkErrors?: readonly SiteError[];
}

function renderWalkErrors(errors: readonly SiteError[]): string {
  if (errors.length === 0) return '';
  const items = errors
    .map(
      (e) => `
        <li class="finding finding--warn">
          <span class="finding__band">${esc(e.scope)}</span>
          <span class="finding__msg">${esc(e.message)}</span>
        </li>`,
    )
    .join('');
  return `<aside class="gap-banner gap-banner--warn"><ul class="findings">${items}</ul></aside>`;
}

function renderIndexFindings(gaps: readonly Gap[], warnings: readonly Warning[]): string {
  const gapCount = gaps.length;
  const warnCount = warnings.length;
  if (gapCount === 0 && warnCount === 0) {
    return `<aside class="gap-banner gap-banner--info"><span class="verdict verdict--ok">PASS</span> <span class="muted">Index conforms.</span></aside>`;
  }
  return `
    <aside class="gap-banner">
      <details ${gapCount > 0 ? 'open' : ''}>
        <summary>
          <span class="verdict verdict--fail">${gapCount} index gap${gapCount === 1 ? '' : 's'}</span>${warnCount > 0 ? ` <span class="muted">· ${warnCount} warning${warnCount === 1 ? '' : 's'}</span>` : ''}
        </summary>
        ${gapCount > 0 ? renderGapList(gaps) : ''}
        ${warnCount > 0 ? renderWarningList(warnings) : ''}
      </details>
    </aside>
  `;
}

export function renderSiteView(input: SiteViewInput): string {
  const { handle, selectedId, detailHtml, gapCounts, nodes, expandedIds, walkPath, meter, flatIndex, walkErrors = [] } = input;
  const treeHtml = renderProgressiveTree(nodes, handle.rootId, {
    selectedId,
    expandedIds,
    gapCounts: gapCounts ?? new Map(),
    walkPath,
  });
  const indexSection = flatIndex !== undefined
    ? `
        <details class="flat-index" open>
          <summary>Full index — ${flatIndex.entries.length} entr${flatIndex.entries.length === 1 ? 'y' : 'ies'} <span class="muted">(diagnostic — agents that walk subtrees never load this)</span></summary>
          ${renderIndexFindings(flatIndex.gaps, flatIndex.warnings)}
          ${renderIndexList(flatIndex.entries, selectedId)}
        </details>
      `
    : '';
  return `
    <section class="result">
      ${renderManifestHeader(handle.manifest, handle.manifestUrl, {
        manifestGaps: handle.manifestGaps,
        manifestWarnings: handle.manifestWarnings,
        meter,
      })}
      ${handle.errors.length > 0 ? renderErrors(handle.errors) : ''}
      ${renderWalkErrors(walkErrors)}
      <div class="site-layout">
        <aside class="tree-pane" aria-label="Tree">
          ${treeHtml}
          ${indexSection}
        </aside>
        <main class="detail-pane-wrap">
          ${detailHtml}
        </main>
      </div>
    </section>
  `;
}

/** Re-export so tests can build TreeNode records directly. */
export type { HtmlFetchOutcome };
