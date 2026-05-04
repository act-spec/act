// SPDX-License-Identifier: Apache-2.0
/**
 * SPA bootstrap.
 *
 * Progressive walk pipeline:
 *  1. URL paste / deep-link / drag-and-drop produces a `SiteHandle`
 *     (manifest fetched + validated). The flat `index.json` is NOT fetched
 *     here — agents that respect subtrees never load it.
 *  2. If the manifest advertises `subtree_url_template`, fetch the root
 *     subtree (depth-1 fanout). Seed the node cache from its `nodes[]`.
 *  3. Render the tree from the node cache. Inner nodes that have children
 *     but haven't been fetched yet appear as "stub" rows.
 *  4. Click a stub → fetch that node (loadNode); detect children; either
 *     auto-expand or wait for an explicit click. Walk-path bytes accrue.
 *  5. Operator may opt into "Estimate HTML cost" (fetches each walk-path
 *     node's `source.human_url` and sums bytes) or "Show full index"
 *     (lazily fetches `index.json` and displays it as a diagnostic view).
 *
 * The schema cache is seeded at module load via `initBrowserSchemas()` so
 * every envelope passes through `@act-spec/validator` before display.
 */
import { ACT_VERSION, INSPECTOR_VERSION } from '@act-spec/inspector';
import { initBrowserSchemas, bundledSchemaCount } from './schemas-bundle.js';
import {
  loadHtml,
  loadIndexLazy,
  loadNode,
  loadSite,
  loadSubtree,
  type HtmlFetchOutcome,
  type IndexEntry,
  type NodeEnvelope,
  type SiteError,
  type SiteHandle,
} from './fetch.js';
import {
  renderErrors,
  renderInitial,
  renderLoading,
  renderNodeDetail,
  renderSiteView,
  type PayloadMeterInput,
  type TreeNode,
} from './render.js';
import { readUrlState, writeUrlState } from './url-state.js';
import { wireDragAndDrop } from './dnd.js';

declare const __SITE_BROWSER_BUILD_SHA__: string;
declare const __SITE_BROWSER_BUILD_TIMESTAMP__: string;

initBrowserSchemas();

import type { Gap, Warning } from '@act-spec/validator';

interface AppState {
  handle: SiteHandle | null;
  selectedId: string | null;
  selectedNode: NodeEnvelope | null;
  selectedGaps: Gap[];
  selectedWarnings: Warning[];
  /** Per-node gap-count cache: keyed by node id, populated as the user
   * explores. Lets the sidebar show "!" chips for nodes we've validated. */
  gapCounts: Map<string, number>;
  /** Progressive-walk state. */
  nodes: Map<string, TreeNode>;
  /** Bytes of every fetch contributing to the current walk path. */
  fetchBytes: Map<string, number>; // key: 'manifest' | `subtree:${id}` | `node:${id}`
  /** Gzipped bytes parallel to fetchBytes — null when CompressionStream is
   * unavailable or the fetch errored. */
  fetchGzipBytes: Map<string, number | null>;
  /** Inner nodes the operator has expanded. */
  expandedIds: Set<string>;
  /** Ids on the path from root → selected, in order. */
  walkPath: string[];
  /** Subtree ids whose envelope we've fetched (regardless of cache hits). */
  fetchedSubtrees: Set<string>;
  /** Walk-related errors (subtree fetches, node fetches). */
  walkErrors: SiteError[];
  /** HTML payload comparison cache, keyed by source.human_url. */
  htmlCache: Map<string, HtmlFetchOutcome>;
  /** True once the operator has opted into HTML cost estimation. */
  htmlEstimateRequested: boolean;
  /** Lazy flat index, populated only when "Show full index" is opened. */
  flatIndex: {
    entries: IndexEntry[];
    bytes: number;
    gzipBytes: number | null;
    gaps: Gap[];
    warnings: Warning[];
  } | null;
}

const state: AppState = {
  handle: null,
  selectedId: null,
  selectedNode: null,
  selectedGaps: [],
  selectedWarnings: [],
  gapCounts: new Map(),
  nodes: new Map(),
  fetchBytes: new Map(),
  fetchGzipBytes: new Map(),
  expandedIds: new Set(),
  walkPath: [],
  fetchedSubtrees: new Set(),
  walkErrors: [],
  htmlCache: new Map(),
  htmlEstimateRequested: false,
  flatIndex: null,
};

const APP_HTML = `
  <header class="app-header">
    <div class="app-header__brand">
      <h1>ACT Site Browser</h1>
      <p class="muted">Paste a URL or <code>act.json</code> manifest URL to walk and inspect a site.</p>
    </div>
  </header>

  <aside class="cors-notice" aria-label="CORS limitation">
    <strong>Heads up:</strong> this browser runs entirely in your browser.
    URL fetches are subject to CORS — many production origins will refuse them
    (including HTML pages reached via <code>source.human_url</code> for the
    HTML-equivalent comparison). Use a local ACT-emitting site or drag a JSON
    file into the page.
  </aside>

  <section class="modes" aria-label="Input">
    <form id="url-form" class="panel" data-panel="url">
      <label for="url-input">Site or manifest URL</label>
      <input
        type="url"
        id="url-input"
        name="url"
        placeholder="https://example.com or https://example.com/.well-known/act.json"
        required
      />
      <button type="submit">Walk</button>
    </form>
  </section>

  <section id="output" class="output" aria-live="polite"></section>

  <footer class="app-footer">
    <p>
      <strong>act_version</strong> <code>${ACT_VERSION}</code> ·
      <strong>inspector</strong> <code>${INSPECTOR_VERSION}</code> ·
      <strong>build</strong> <code>${__SITE_BROWSER_BUILD_SHA__}</code> ·
      <strong>built</strong> <code>${__SITE_BROWSER_BUILD_TIMESTAMP__}</code> ·
      <strong>schemas</strong> <code>${bundledSchemaCount()}</code>
    </p>
    <p>
      <a href="https://github.com/act-spec/act" target="_blank" rel="noopener noreferrer">Spec repo</a>
      · Apache-2.0 licensed
    </p>
  </footer>
`;

function mount(): void {
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('site-browser: #app root not found');
  }
  root.innerHTML = APP_HTML;
  showOutput(root, renderInitial());
  wireUrlForm(root);
  wireOutputDelegation(root);
  wireDragAndDrop(root, (outcome) => {
    if (outcome.kind === 'unsupported') {
      showOutput(
        root,
        renderErrors([{ scope: 'manifest', message: outcome.message }]),
      );
      return;
    }
    hydrateFromDroppedManifest(root, outcome.manifest, outcome.syntheticUrl);
  });
  void bootstrapFromUrlState(root);
}

function showOutput(root: HTMLElement, html: string): void {
  const out = root.querySelector('#output');
  if (out) out.innerHTML = html;
}

function resetWalkState(): void {
  state.selectedId = null;
  state.selectedNode = null;
  state.selectedGaps = [];
  state.selectedWarnings = [];
  state.gapCounts = new Map();
  state.nodes = new Map();
  state.fetchBytes = new Map();
  state.fetchGzipBytes = new Map();
  state.expandedIds = new Set();
  state.walkPath = [];
  state.fetchedSubtrees = new Set();
  state.walkErrors = [];
  state.htmlCache = new Map();
  state.htmlEstimateRequested = false;
  state.flatIndex = null;
}

function recordTreeNode(envelope: NodeEnvelope, loaded: boolean): void {
  const existing = state.nodes.get(envelope.id);
  const parent = envelope.parent ?? existing?.parent ?? null;
  const children = Array.isArray(envelope.children) && envelope.children.length > 0
    ? envelope.children
    : existing?.children;
  const source = envelope.source ?? existing?.source;
  const merged: TreeNode = {
    id: envelope.id,
    type: envelope.type,
    title: envelope.title ?? envelope.id,
    parent,
    loaded: loaded || (existing?.loaded ?? false),
    expanded: existing?.expanded ?? false,
    ...(children !== undefined ? { children } : {}),
    ...(source !== undefined ? { source } : {}),
  };
  state.nodes.set(envelope.id, merged);
}

function recordStubChildren(parentId: string, childIds: readonly string[]): void {
  for (const id of childIds) {
    if (state.nodes.has(id)) continue;
    state.nodes.set(id, {
      id,
      type: 'unknown',
      title: id,
      parent: parentId,
      loaded: false,
      expanded: false,
    });
  }
}

function computeWalkPath(selectedId: string | null): string[] {
  if (!selectedId) {
    if (state.handle && state.nodes.has(state.handle.rootId)) return [state.handle.rootId];
    return [];
  }
  const path: string[] = [];
  let cursor: string | null | undefined = selectedId;
  const guard = new Set<string>();
  while (cursor) {
    if (guard.has(cursor)) break;
    guard.add(cursor);
    path.unshift(cursor);
    const n = state.nodes.get(cursor);
    cursor = n?.parent ?? null;
  }
  return path;
}

function totalWalkBytes(): number {
  let bytes = state.fetchBytes.get('manifest') ?? 0;
  for (const id of state.walkPath) {
    bytes += state.fetchBytes.get(`subtree:${id}`) ?? 0;
    bytes += state.fetchBytes.get(`node:${id}`) ?? 0;
  }
  return bytes;
}

/** Sum gzipped bytes across the walk path. Returns null when any fetch on
 * the path is missing a gzipBytes value (e.g. CompressionStream not
 * supported, or a fetch hasn't completed yet). */
function totalWalkGzipBytes(): number | null {
  const m = state.fetchGzipBytes.get('manifest');
  if (m === undefined || m === null) return null;
  let bytes = m;
  for (const id of state.walkPath) {
    if (state.fetchBytes.has(`subtree:${id}`)) {
      const v = state.fetchGzipBytes.get(`subtree:${id}`);
      if (v === undefined || v === null) return null;
      bytes += v;
    }
    if (state.fetchBytes.has(`node:${id}`)) {
      const v = state.fetchGzipBytes.get(`node:${id}`);
      if (v === undefined || v === null) return null;
      bytes += v;
    }
  }
  return bytes;
}

function walkLabel(): string {
  let subtreeCount = 0;
  let nodeCount = 0;
  for (const id of state.walkPath) {
    if (state.fetchBytes.has(`subtree:${id}`)) subtreeCount += 1;
    if (state.fetchBytes.has(`node:${id}`)) nodeCount += 1;
  }
  const parts = ['manifest'];
  if (subtreeCount > 0) parts.push(`${subtreeCount} subtree${subtreeCount === 1 ? '' : 's'}`);
  if (nodeCount > 0) parts.push(`${nodeCount} node${nodeCount === 1 ? '' : 's'}`);
  return parts.join(' + ');
}

function buildMeter(): PayloadMeterInput {
  const walkBytes = totalWalkBytes();
  const walkGzipBytes = totalWalkGzipBytes();
  let htmlBytes: number | undefined;
  let htmlGzipBytes: number | null | undefined;
  let htmlMeasured: { ok: number; total: number } | undefined;
  if (state.htmlEstimateRequested) {
    let ok = 0;
    let total = 0;
    let bytes = 0;
    let gzip = 0;
    let gzipKnown = true;
    for (const id of state.walkPath) {
      const url = state.nodes.get(id)?.source?.human_url;
      if (!url) {
        total += 1;
        continue;
      }
      total += 1;
      const cached = state.htmlCache.get(url);
      if (!cached) continue;
      if (cached.ok) {
        ok += 1;
        bytes += cached.bytes;
        if (cached.gzipBytes === null) gzipKnown = false;
        else gzip += cached.gzipBytes;
      }
    }
    htmlBytes = bytes;
    htmlGzipBytes = gzipKnown && ok > 0 ? gzip : null;
    htmlMeasured = { ok, total };
  }
  const meter: PayloadMeterInput = {
    walkBytes,
    walkLabel: walkLabel(),
  };
  if (walkGzipBytes !== null) meter.walkGzipBytes = walkGzipBytes;
  if (htmlBytes !== undefined) meter.htmlBytes = htmlBytes;
  if (htmlGzipBytes !== undefined) meter.htmlGzipBytes = htmlGzipBytes;
  if (htmlMeasured !== undefined) meter.htmlMeasured = htmlMeasured;
  if (state.flatIndex !== null) {
    meter.indexBytes = state.flatIndex.bytes;
    if (state.flatIndex.gzipBytes !== null) meter.indexGzipBytes = state.flatIndex.gzipBytes;
    meter.indexEntryCount = state.flatIndex.entries.length;
  }
  return meter;
}

function rerenderSiteView(root: HTMLElement): void {
  if (state.handle === null) {
    showOutput(root, renderInitial());
    return;
  }
  const detailHtml = state.selectedNode !== null
    ? renderNodeDetail(state.selectedNode, state.selectedGaps, state.selectedWarnings)
    : '<p class="muted">Select a node from the tree.</p>';
  state.walkPath = computeWalkPath(state.selectedId);
  showOutput(
    root,
    renderSiteView({
      handle: state.handle,
      selectedId: state.selectedId,
      detailHtml,
      gapCounts: state.gapCounts,
      nodes: state.nodes,
      expandedIds: state.expandedIds,
      walkPath: state.walkPath,
      meter: buildMeter(),
      flatIndex: state.flatIndex !== null
        ? { entries: state.flatIndex.entries, gaps: state.flatIndex.gaps, warnings: state.flatIndex.warnings }
        : undefined,
      walkErrors: state.walkErrors,
    }),
  );
}

async function fetchRootSubtree(root: HTMLElement): Promise<void> {
  if (!state.handle) return;
  const handle = state.handle;
  // Try subtree first (Standard+); fall back to fetching the root node
  // directly (Core-tier or any manifest that doesn't emit a subtree at the
  // advertised root). Either path seeds the node cache + child stubs.
  if (handle.hasSubtreeTemplate) {
    const outcome = await loadSubtree(handle, handle.rootId);
    if (outcome.subtree) {
      state.fetchBytes.set(`subtree:${handle.rootId}`, outcome.bytes);
      state.fetchGzipBytes.set(`subtree:${handle.rootId}`, outcome.gzipBytes);
      state.fetchedSubtrees.add(handle.rootId);
      for (const env of outcome.subtree.nodes) {
        recordTreeNode(env, true);
        if (Array.isArray(env.children)) {
          recordStubChildren(env.id, env.children);
        }
      }
      state.expandedIds.add(handle.rootId);
      rerenderSiteView(root);
      return;
    }
    // Subtree fetch failed — surface the error but keep going via the
    // node fallback so the operator can still walk the tree.
    if (outcome.error) state.walkErrors.push(outcome.error);
  }
  const nodeOutcome = await loadNode(handle, handle.rootId);
  if (nodeOutcome.error) {
    state.walkErrors.push(nodeOutcome.error);
  }
  if (nodeOutcome.node) {
    state.fetchBytes.set(`node:${handle.rootId}`, nodeOutcome.bytes);
    state.fetchGzipBytes.set(`node:${handle.rootId}`, nodeOutcome.gzipBytes);
    recordTreeNode(nodeOutcome.node, true);
    if (Array.isArray(nodeOutcome.node.children) && nodeOutcome.node.children.length > 0) {
      recordStubChildren(handle.rootId, nodeOutcome.node.children);
      state.expandedIds.add(handle.rootId);
    }
  } else {
    // Neither subtree nor root node exists — fall back to the flat index so
    // the tree can still be seeded (common on static sites with no "root" id).
    const indexOutcome = await loadIndexLazy(handle);
    if (indexOutcome.error) {
      state.walkErrors.push(indexOutcome.error);
    } else if (indexOutcome.entries.length > 0) {
      // Index loaded fine; the subtree/node 404s are expected — clear them.
      state.walkErrors = state.walkErrors.filter(
        (e) => e.scope !== 'subtree' && e.scope !== 'node',
      );
      for (const entry of indexOutcome.entries) {
        recordTreeNode(entry, false);
        if (Array.isArray(entry.children)) recordStubChildren(entry.id, entry.children);
      }
    }
  }
  rerenderSiteView(root);
}

async function selectNode(root: HTMLElement, id: string): Promise<void> {
  if (!state.handle) return;
  const handle = state.handle;
  const node = state.nodes.get(id);
  // Toggle expansion when an already-loaded inner node is re-clicked.
  if (node && node.loaded && Array.isArray(node.children) && node.children.length > 0 && state.selectedId === id) {
    if (state.expandedIds.has(id)) state.expandedIds.delete(id);
    else state.expandedIds.add(id);
    rerenderSiteView(root);
    return;
  }
  state.selectedId = id;
  state.selectedNode = null;
  state.selectedGaps = [];
  state.selectedWarnings = [];
  rerenderSiteView(root);
  const detail = root.querySelector('.detail-pane-wrap');
  if (detail) detail.innerHTML = renderLoading(`Fetching node ${id} …`);

  // Inner nodes (those we know have children) try the subtree first when
  // available — that single fetch gives us the node envelope plus its
  // immediate children with full type/title/summary, which seeds the tree
  // rows correctly instead of leaving them as "unknown" stubs. Leaves and
  // unknown-shape nodes fall through to the node fetch.
  const knownHasChildren = node && Array.isArray(node.children) && node.children.length > 0;
  if (handle.hasSubtreeTemplate && knownHasChildren && !state.fetchedSubtrees.has(id)) {
    const subOutcome = await loadSubtree(handle, id);
    if (subOutcome.subtree) {
      state.fetchBytes.set(`subtree:${id}`, subOutcome.bytes);
      state.fetchGzipBytes.set(`subtree:${id}`, subOutcome.gzipBytes);
      state.fetchedSubtrees.add(id);
      for (const env of subOutcome.subtree.nodes) {
        recordTreeNode(env, true);
        if (Array.isArray(env.children)) recordStubChildren(env.id, env.children);
      }
      const selectedEnv = subOutcome.subtree.nodes.find((n) => n.id === id) ?? null;
      if (selectedEnv !== null) {
        state.selectedNode = selectedEnv;
        // Subtree validation reports gaps/warnings for the bundle as a
        // whole; surface them on the selected node row for visibility.
        state.selectedGaps = subOutcome.gaps;
        state.selectedWarnings = subOutcome.warnings;
        state.gapCounts.set(id, subOutcome.gaps.length);
      }
      state.expandedIds.add(id);
      if (state.htmlEstimateRequested) await fetchHtmlForWalk();
      rerenderSiteView(root);
      writeUrlState({ site: currentSiteParam(), node: id });
      return;
    }
    // Subtree miss — record a soft warning, fall through to node fetch.
    if (subOutcome.error) state.walkErrors.push(subOutcome.error);
  }

  const outcome = await loadNode(handle, id);
  if (outcome.error) {
    state.selectedNode = null;
    if (detail) detail.innerHTML = renderErrors([outcome.error]);
    return;
  }
  if (outcome.node) {
    state.selectedNode = outcome.node;
    state.selectedGaps = outcome.gaps;
    state.selectedWarnings = outcome.warnings;
    state.gapCounts.set(id, outcome.gaps.length);
    state.fetchBytes.set(`node:${id}`, outcome.bytes);
    state.fetchGzipBytes.set(`node:${id}`, outcome.gzipBytes);
    recordTreeNode(outcome.node, true);
    if (Array.isArray(outcome.node.children) && outcome.node.children.length > 0) {
      recordStubChildren(id, outcome.node.children);
      state.expandedIds.add(id);
    }
    if (state.htmlEstimateRequested) await fetchHtmlForWalk();
    rerenderSiteView(root);
  }
  writeUrlState({ site: currentSiteParam(), node: id });
}

async function fetchHtmlForWalk(): Promise<void> {
  state.walkPath = computeWalkPath(state.selectedId);
  const fetches: Promise<HtmlFetchOutcome>[] = [];
  for (const id of state.walkPath) {
    const url = state.nodes.get(id)?.source?.human_url;
    if (!url) continue;
    if (state.htmlCache.has(url)) continue;
    fetches.push(loadHtml(url));
  }
  if (fetches.length === 0) return;
  const results = await Promise.all(fetches);
  for (const r of results) state.htmlCache.set(r.url, r);
}

async function estimateHtml(root: HTMLElement): Promise<void> {
  state.htmlEstimateRequested = true;
  await fetchHtmlForWalk();
  rerenderSiteView(root);
}

async function showFullIndex(root: HTMLElement): Promise<void> {
  if (!state.handle) return;
  const outcome = await loadIndexLazy(state.handle);
  if (outcome.error) {
    state.walkErrors.push(outcome.error);
    rerenderSiteView(root);
    return;
  }
  state.flatIndex = {
    entries: outcome.entries,
    bytes: outcome.bytes,
    gzipBytes: outcome.gzipBytes,
    gaps: outcome.gaps,
    warnings: outcome.warnings,
  };
  rerenderSiteView(root);
}

function currentSiteParam(): string {
  return state.handle?.manifestUrl ?? '';
}

function wireUrlForm(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>('#url-form');
  if (!form) return;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = form.querySelector<HTMLInputElement>('#url-input');
    const value = input?.value.trim() ?? '';
    if (value.length === 0) return;
    void runLoad(root, value);
  });
}

async function runLoad(root: HTMLElement, input: string): Promise<void> {
  showOutput(root, renderLoading(`Fetching manifest from ${input} …`));
  const outcome = await loadSite(input);
  if ('manifestUrl' in outcome) {
    state.handle = outcome;
    resetWalkState();
    state.fetchBytes.set('manifest', outcome.manifestBytes);
    state.fetchGzipBytes.set('manifest', outcome.manifestGzipBytes);
    rerenderSiteView(root);
    writeUrlState({ site: outcome.manifestUrl });
    await fetchRootSubtree(root);
    // Auto-select root for orientation.
    if (state.nodes.has(outcome.rootId)) {
      void selectNode(root, outcome.rootId);
    }
  } else {
    state.handle = null;
    showOutput(root, renderErrors(outcome.errors));
  }
}

async function bootstrapFromUrlState(root: HTMLElement): Promise<void> {
  const initial = readUrlState();
  if (typeof initial.site !== 'string' || initial.site.length === 0) return;
  const urlInput = root.querySelector<HTMLInputElement>('#url-input');
  if (urlInput) urlInput.value = initial.site;
  showOutput(root, renderLoading(`Fetching manifest from ${initial.site} …`));
  const outcome = await loadSite(initial.site);
  if ('manifestUrl' in outcome) {
    state.handle = outcome;
    resetWalkState();
    state.fetchBytes.set('manifest', outcome.manifestBytes);
    state.fetchGzipBytes.set('manifest', outcome.manifestGzipBytes);
    rerenderSiteView(root);
    await fetchRootSubtree(root);
    if (typeof initial.node === 'string' && initial.node.length > 0) {
      void selectNode(root, initial.node);
    } else if (state.nodes.has(outcome.rootId)) {
      void selectNode(root, outcome.rootId);
    }
  } else {
    state.handle = null;
    showOutput(root, renderErrors(outcome.errors));
  }
}

function hydrateFromDroppedManifest(
  root: HTMLElement,
  manifest: unknown,
  syntheticUrl: string,
): void {
  const error: SiteError = {
    scope: 'subtree',
    message:
      `Loaded manifest from drop (${syntheticUrl}). The progressive walk needs a real origin to fetch subtrees and nodes; only the manifest is available offline.`,
  };
  const manifestJson = JSON.stringify(manifest);
  const m = manifest as SiteHandle['manifest'];
  state.handle = {
    manifestUrl: syntheticUrl,
    manifest: m,
    rootId:
      typeof (m as { root_id?: unknown }).root_id === 'string'
        ? (m as { root_id: string }).root_id
        : 'root',
    errors: [error],
    manifestGaps: [],
    manifestWarnings: [],
    manifestBytes: manifestJson.length,
    manifestGzipBytes: null,
    hasSubtreeTemplate: typeof m.subtree_url_template === 'string',
  };
  resetWalkState();
  state.fetchBytes.set('manifest', state.handle.manifestBytes);
  state.fetchGzipBytes.set('manifest', null);
  rerenderSiteView(root);
}

function wireOutputDelegation(root: HTMLElement): void {
  const out = root.querySelector('#output');
  if (!out) return;
  out.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    // Payload-meter CTAs.
    const cta = target.closest<HTMLElement>('[data-action]');
    if (cta) {
      const action = cta.dataset['action'];
      if (action === 'estimate-html') {
        ev.preventDefault();
        void estimateHtml(root);
        return;
      }
      if (action === 'show-full-index') {
        ev.preventDefault();
        void showFullIndex(root);
        return;
      }
      if (action === 'goto-node' && cta.dataset['id']) {
        ev.preventDefault();
        if (state.handle === null) return;
        void selectNode(root, cta.dataset['id']);
        return;
      }
      if (action === 'set-url' && cta.dataset['url']) {
        ev.preventDefault();
        const urlInput = root.querySelector<HTMLInputElement>('#url-input');
        if (urlInput) {
          urlInput.value = cta.dataset['url'];
          urlInput.focus();
        }
        return;
      }
    }

    const item = target.closest<HTMLElement>('.tree__item');
    if (item && item.dataset['nodeId']) {
      const id = item.dataset['nodeId'];
      if (state.handle === null) return;
      void selectNode(root, id);
    }
  });
}

mount();
