/**
 * In-package fixtures for `@act-spec/mcp-bridge` unit tests. Excluded from
 * coverage thresholds (test scaffolding, per vitest.config.ts).
 *
 * The helpers build:
 *   - `coreManifest()`: a Core-level manifest with three nodes.
 *   - `standardManifest()`: same plus `subtree_url_template`.
 *   - `makeRuntime({ subtree })`: an `ActRuntime` with three docs and
 *     optional `resolveSubtree`.
 *   - `makeStaticEnvelopes()`: a pre-loaded set of envelopes for a
 *     `StaticSource` (mirrors the runtime fixtures so the cross-source
 *     tests can compare).
 */
import { deriveEtag } from '@act-spec/validator';

import type {
  ActRuntime,
  Index,
  Manifest,
  Node,
} from '@act-spec/runtime-core';

const FIXED_DATE = '2026-05-02T00:00:00Z';

export function coreManifest(): Manifest {
  return {
    act_version: '0.1',
    site: { name: 'fixture.example' },
    delivery: 'runtime',
    conformance: { level: 'core' },
    auth: { schemes: ['bearer'] },
    index_url: '/act/index.json',
    node_url_template: '/act/n/{id}',
  };
}

export function standardManifest(): Manifest {
  return {
    ...coreManifest(),
    conformance: { level: 'standard' },
    subtree_url_template: '/act/sub/{id}',
  };
}

export const FIXTURE_DOCS = [
  { id: 'doc/intro', title: 'Intro', summary: 'Welcome.', body: 'Body of intro.' },
  { id: 'doc/setup', title: 'Setup', summary: 'How to set up.', body: 'Body of setup.' },
  { id: 'doc/billing', title: 'Billing', summary: 'Plans and pricing.', body: 'Body of billing.' },
] as const;

export function makeRuntime({ subtree }: { subtree: boolean }): ActRuntime {
  const runtime: ActRuntime = {
    resolveManifest(_req, _ctx) {
      return Promise.resolve({
        kind: 'ok',
        value: subtree ? standardManifest() : coreManifest(),
      });
    },
    resolveIndex(_req, _ctx) {
      return Promise.resolve({ kind: 'ok', value: makeIndex() });
    },
    resolveNode(_req, _ctx, params) {
      const doc = FIXTURE_DOCS.find((d) => d.id === params.id);
      if (!doc) return Promise.resolve({ kind: 'not_found' });
      return Promise.resolve({ kind: 'ok', value: makeNode(doc) });
    },
  };
  if (subtree) {
    runtime.resolveSubtree = (_req, _ctx, params) => {
      const doc = FIXTURE_DOCS.find((d) => d.id === params.id);
      if (!doc) return Promise.resolve({ kind: 'not_found' });
      return Promise.resolve({
        kind: 'ok',
        value: {
          act_version: '0.1',
          root: doc.id,
          etag: deriveEtag({ id: doc.id, kind: 'subtree' }),
          depth: params.depth,
          nodes: [makeNode(doc)],
        },
      });
    };
  }
  return runtime;
}

export function makeIndex(): Index {
  return {
    act_version: '0.1',
    nodes: FIXTURE_DOCS.map((d) => ({
      id: d.id,
      type: 'article',
      title: d.title,
      summary: d.summary,
      tokens: { summary: 8 },
      etag: deriveEtag({ id: d.id, title: d.title, summary: d.summary }),
      updated_at: FIXED_DATE,
    })),
  };
}

export function makeNode(doc: { id: string; title: string; summary: string; body: string }): Node {
  return {
    act_version: '0.1',
    id: doc.id,
    type: 'article',
    title: doc.title,
    summary: doc.summary,
    content: [{ type: 'prose', text: doc.body }],
    tokens: { summary: 8, body: 25 },
    etag: deriveEtag({ id: doc.id, title: doc.title }),
    updated_at: FIXED_DATE,
  };
}

export function makeStaticEnvelopes(): {
  manifest: Manifest;
  index: Index;
  nodes: Node[];
} {
  return {
    manifest: coreManifest(),
    index: makeIndex(),
    nodes: FIXTURE_DOCS.map((d) => makeNode(d)),
  };
}
