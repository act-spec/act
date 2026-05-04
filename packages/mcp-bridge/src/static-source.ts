/**
 * PRD-602-R24 — `StaticSource` reader.
 *
 * The bridge consumes the same walker entry point `@act-spec/validator`'s
 * `walkStatic` uses (PRD-706-R13 drift prevention): given a `manifestUrl`
 * (or a `rootDir` filesystem hint), enumerate the mount's manifest, index,
 * and node envelopes. The MCP-side ListResources surface for a static
 * mount comes from this reader's output; the validator's static walk reads
 * the same data, foreclosing drift between the MCP-surfaced graph and the
 * validator-walked graph.
 *
 * The reader is intentionally minimal for v0.1:
 *  - When `envelopes` is supplied (build-time pre-walk), the reader uses
 *    those directly without touching the network or filesystem.
 *  - When `rootDir` is supplied, the reader resolves manifest / index /
 *    nodes relative to it (suffixing the filesystem path from the
 *    manifest's `index_url` and `node_url_template`).
 *  - Otherwise the reader fetches `manifestUrl` over HTTP.
 *
 * The reader returns an iterable of node envelopes; the bridge converts
 * each envelope to an MCP resource entry.
 */
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Manifest, Node } from '@act-spec/runtime-core';

import type { StaticSource } from './types.js';

/**
 * Result of reading a static source. Mirrors the `walkStatic` input
 * surface (PRD-706-R13 drift prevention).
 */
export interface StaticReadResult {
  readonly manifest: Manifest;
  readonly index: { readonly nodes: ReadonlyArray<{ id: string; title?: string; summary?: string; etag?: string }> };
  readonly nodes: ReadonlyArray<Node>;
}

/**
 * Read a static source. Pre-loaded `envelopes` win over filesystem /
 * network fetches.
 *
 * @param fetchImpl optional fetch implementation; defaults to global fetch.
 *                  Allows tests to inject a synthetic fetcher and the
 *                  bridge's conformance walker to share the same fetcher
 *                  the validator uses (PRD-706-R13).
 */
export async function readStaticSource(
  source: StaticSource,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<StaticReadResult> {
  // Path 1 — pre-loaded envelopes (used by tests and by deployments that
  // pre-walk during the build step).
  if (source.envelopes?.manifest && source.envelopes.index) {
    return {
      manifest: source.envelopes.manifest,
      index: source.envelopes.index as StaticReadResult['index'],
      nodes: (source.envelopes.nodes ?? []) as readonly Node[],
    };
  }

  // Path 2 — filesystem read from rootDir.
  if (source.rootDir) {
    return readFromRootDir(source);
  }

  // Path 3 — HTTP fetch of manifestUrl + chained envelopes.
  return readFromHttp(source, fetchImpl);
}

async function readFromRootDir(source: StaticSource): Promise<StaticReadResult> {
  const root = source.rootDir;
  if (root === undefined) {
    throw new Error('readFromRootDir invoked without rootDir');
  }
  const rootAbs = root.startsWith('file:') ? fileURLToPath(root) : resolvePath(root);

  // The manifestUrl might be a full URL, an origin-relative path, or just
  // the manifest filename. We extract the path component.
  const manifestPath = pathFromUrl(source.manifestUrl);
  const manifestAbs = resolvePath(rootAbs, stripLeadingSlash(manifestPath));
  const manifestText = await readFile(manifestAbs, 'utf8');
  const manifest = JSON.parse(manifestText) as Manifest;

  // PRD-100-R8: index_url is an absolute path relative to the same origin
  // as the manifest. We resolve it under rootDir.
  const indexPath = manifest.index_url ?? '/index.json';
  const indexAbs = resolvePath(rootAbs, stripLeadingSlash(indexPath));
  const indexText = await readFile(indexAbs, 'utf8');
  const index = JSON.parse(indexText) as StaticReadResult['index'];

  // Node URLs follow `node_url_template`; we substitute `{id}`.
  const nodes: Node[] = [];
  const template = manifest.node_url_template;
  if (typeof template === 'string') {
    for (const entry of index.nodes) {
      if (typeof entry.id !== 'string') continue;
      const nodePath = template.replace('{id}', entry.id);
      try {
        const nodeAbs = resolvePath(rootAbs, stripLeadingSlash(nodePath));
        const nodeText = await readFile(nodeAbs, 'utf8');
        nodes.push(JSON.parse(nodeText) as Node);
      } catch {
        // A static walker that can't read every node is a validator
        // concern (PRD-600-R11). The bridge's MCP surface lists what's
        // readable; missing nodes simply don't appear in ListResources.
      }
    }
  }
  return { manifest, index, nodes };
}

async function readFromHttp(
  source: StaticSource,
  fetchImpl: typeof globalThis.fetch,
): Promise<StaticReadResult> {
  const manifestRes = await fetchImpl(source.manifestUrl);
  if (!manifestRes.ok) {
    throw new Error(
      `static source manifest unreachable: ${source.manifestUrl} returned HTTP ${manifestRes.status}`,
    );
  }
  const manifest = (await manifestRes.json()) as Manifest;
  const indexUrl = resolveAgainstBase(source.manifestUrl, manifest.index_url ?? '/index.json');
  const idxRes = await fetchImpl(indexUrl);
  if (!idxRes.ok) {
    throw new Error(`static source index unreachable: ${indexUrl} returned HTTP ${idxRes.status}`);
  }
  const index = (await idxRes.json()) as StaticReadResult['index'];

  const nodes: Node[] = [];
  const template = manifest.node_url_template;
  if (typeof template === 'string') {
    for (const entry of index.nodes) {
      if (typeof entry.id !== 'string') continue;
      const nodeUrl = resolveAgainstBase(source.manifestUrl, template.replace('{id}', entry.id));
      try {
        const nodeRes = await fetchImpl(nodeUrl);
        if (!nodeRes.ok) continue;
        nodes.push((await nodeRes.json()) as Node);
      } catch {
        // Skip; see rootDir path commentary.
      }
    }
  }
  return { manifest, index, nodes };
}

function pathFromUrl(input: string): string {
  if (input.startsWith('http://') || input.startsWith('https://') || input.startsWith('file://')) {
    try {
      return new URL(input).pathname;
    } catch {
      return input;
    }
  }
  return input;
}

function stripLeadingSlash(p: string): string {
  return p.replace(/^\/+/, '');
}

function resolveAgainstBase(base: string, target: string): string {
  if (target.startsWith('http://') || target.startsWith('https://')) return target;
  try {
    const baseUrl = new URL(base);
    if (target.startsWith('/')) {
      return `${baseUrl.origin}${target}`;
    }
    return new URL(target, baseUrl).toString();
  } catch {
    return target;
  }
}
