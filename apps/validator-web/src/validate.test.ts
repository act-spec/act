// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSchemasFromRaw, setCompiledSchemas } from '@act-spec/validator';
import { validatePaste } from './validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const schemasDir = path.join(repoRoot, 'schemas');

beforeAll(() => {
  // Mirror what `schemas-bundle.ts` does in the browser build: hand the raw
  // schemas to the validator's compileSchemasFromRaw + setCompiledSchemas
  // helpers, so we never touch the Node-only `loadSchemas()` path. This
  // guards against a regression where the SPA accidentally falls back to
  // `loadSchemas()` (which would break the production browser build).
  const raw: { $id?: string; [k: string]: unknown }[] = [];
  for (const series of readdirSync(schemasDir)) {
    if (!/^\d{3}$/.test(series)) continue;
    const dir = path.join(schemasDir, series);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.schema.json'))) {
      raw.push(
        JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as {
          $id?: string;
          [k: string]: unknown;
        },
      );
    }
  }
  setCompiledSchemas(compileSchemasFromRaw(raw));
});

describe('validatePaste — dispatch routing', () => {
  it('routes a manifest paste to validateManifest', () => {
    const outcome = validatePaste(
      JSON.stringify({
        act_version: '0.1',
        site: { id: 'demo', name: 'Demo', origin: 'https://x' },
        generated_at: '2026-01-01T00:00:00Z',
        index_url: '/i.json',
        node_url_template: '/n/{id}.json',
        root_id: 'root',
        conformance: { level: 'core' },
        delivery: 'static',
      }),
    );
    expect(outcome.envelope).toBe('manifest');
    // Manifest above is intentionally minimal-but-valid; it should not
    // produce gaps from this routing test (warnings are fine).
    expect(outcome.result.gaps).toEqual([]);
  });

  it('routes an NDJSON paste to validateNdjsonIndex', () => {
    const outcome = validatePaste(
      [
        JSON.stringify({ id: 'a', etag: 's256:AAAAAAAAAAAAAAAAAAAAAA' }),
        JSON.stringify({ id: 'b', etag: 's256:AAAAAAAAAAAAAAAAAAAAAA' }),
      ].join('\n'),
    );
    expect(outcome.envelope).toBe('ndjson');
  });

  it('routes a node paste to validateNode (default fallback)', () => {
    const outcome = validatePaste('{"act_version":"0.1","id":"x","etag":"s256:AAAAAAAAAAAAAAAAAAAAAA"}');
    expect(outcome.envelope).toBe('node');
  });

  it('honours forceKind override (UI "treat as index")', () => {
    const outcome = validatePaste(
      '{"act_version":"0.1","nodes":[]}',
      'index',
    );
    expect(outcome.envelope).toBe('index');
  });

  it('routes an index paste to validateIndex', () => {
    const outcome = validatePaste(
      '{"act_version":"0.1","nodes":[{"id":"a","etag":"s256:AAAAAAAAAAAAAAAAAAAAAA"}]}',
    );
    expect(outcome.envelope).toBe('index');
  });

  it('routes a subtree paste to validateSubtree', () => {
    const outcome = validatePaste(
      '{"act_version":"0.1","root":"a","depth":1,"etag":"s256:AAAAAAAAAAAAAAAAAAAAAA","nodes":[]}',
    );
    expect(outcome.envelope).toBe('subtree');
  });

  it('routes an error paste to validateError', () => {
    const outcome = validatePaste(
      '{"act_version":"0.1","error":{"code":"not_found","message":"x"}}',
    );
    expect(outcome.envelope).toBe('error');
  });

  it('returns a JSON-parse gap when the input is unparseable (via node fallback)', () => {
    const outcome = validatePaste('not json at all');
    expect(outcome.envelope).toBe('node');
    expect(outcome.result.gaps.length).toBeGreaterThan(0);
  });
});
