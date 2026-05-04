/**
 * PRD-501-R4 — catch-all `[...id]` joining and URL synthesis tests.
 */
import { describe, expect, it } from 'vitest';

import { buildEndpointUrl, readCatchAllId } from './catchall.js';

describe('PRD-501-R4: catch-all id joining', () => {
  it('joins an array of segments with /', async () => {
    const id = await readCatchAllId({ params: { id: ['doc', 'proj-launch-2026'] } });
    expect(id).toBe('doc/proj-launch-2026');
  });

  it('returns a single string when params.id is already a string', async () => {
    const id = await readCatchAllId({ params: { id: 'doc/single' } });
    expect(id).toBe('doc/single');
  });

  it('returns null when params is missing', async () => {
    expect(await readCatchAllId(undefined)).toBeNull();
    expect(await readCatchAllId({})).toBeNull();
  });

  it('returns null when params.id is undefined', async () => {
    expect(await readCatchAllId({ params: {} })).toBeNull();
  });

  it('returns null when params.id is an empty array (Next.js edge case)', async () => {
    expect(await readCatchAllId({ params: { id: [] } })).toBeNull();
  });

  it('awaits a Promise<params> (Next 15 async params)', async () => {
    const id = await readCatchAllId({
      params: Promise.resolve({ id: ['doc', 'async'] }),
    });
    expect(id).toBe('doc/async');
  });
});

describe('PRD-501-R4: buildEndpointUrl per-segment encoding', () => {
  it('substitutes {id} with the percent-encoded canonical id', () => {
    const url = buildEndpointUrl({
      origin: 'https://example.com',
      basePath: '',
      template: '/act/n/{id}',
      canonicalId: 'doc/proj-launch-2026',
    });
    // Per PRD-500-R13 / runtime-core's encodeIdForUrl, `/` is preserved
    // as the segment separator; non-pchar bytes are encoded.
    expect(url.pathname).toBe('/act/n/doc/proj-launch-2026');
  });

  it('preserves : and @ in IDs (PRD-500-R13)', () => {
    const url = buildEndpointUrl({
      origin: 'https://example.com',
      basePath: '',
      template: '/act/n/{id}',
      canonicalId: 'doc/admin@v1',
    });
    expect(url.pathname).toContain('admin@v1');
  });

  it('preserves the search component when supplied', () => {
    const url = buildEndpointUrl({
      origin: 'https://example.com',
      basePath: '',
      template: '/act/sub/{id}',
      canonicalId: 'doc/x',
      search: '?depth=5',
    });
    expect(url.search).toBe('?depth=5');
  });

  it('prepends a non-empty basePath', () => {
    const url = buildEndpointUrl({
      origin: 'https://example.com',
      basePath: '/app',
      template: '/act/n/{id}',
      canonicalId: 'doc/x',
    });
    expect(url.pathname).toBe('/app/act/n/doc/x');
  });
});
