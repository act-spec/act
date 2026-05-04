/**
 * PRD-505-R8 — `ActResponse` → `Response` translation tests.
 *
 * Body branches:
 *   - `null`     → 304 / HEAD; pass through with no body.
 *   - `string`   → JSON envelope body; verbatim.
 *   - `AsyncIterable<string>` → NDJSON via manual `new ReadableStream`.
 *
 * The SDK MUST NOT use `ReadableStream.from(asyncIterable)` per PRD-505-R8
 * (portability — Node.js < 22 / some Bun versions). The test for the
 * NDJSON branch consumes the stream via `Response.text()` to confirm it
 * yields the joined lines.
 */
import { describe, expect, it } from 'vitest';

import { toFetchResponse } from './response.js';

describe('PRD-505-R8 toFetchResponse', () => {
  it('translates a JSON-string body verbatim', async () => {
    const headers = new Headers({ 'Content-Type': 'application/act-node+json' });
    const resp = toFetchResponse({
      status: 200,
      headers,
      body: '{"act_version":"0.1"}',
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('application/act-node+json');
    expect(await resp.text()).toBe('{"act_version":"0.1"}');
  });

  it('translates a 304 (null body) without writing a body', async () => {
    const headers = new Headers({ ETag: '"s256:abc"' });
    const resp = toFetchResponse({ status: 304, headers, body: null });
    expect(resp.status).toBe(304);
    expect(resp.headers.get('ETag')).toBe('"s256:abc"');
    expect(await resp.text()).toBe('');
  });

  it('streams NDJSON via manual ReadableStream (PRD-505-R8)', async () => {
    async function* gen(): AsyncIterable<string> {
      yield '{"id":"a"}\n';
      yield '{"id":"b"}\n';
    }
    const resp = toFetchResponse({
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/act-index+json' }),
      body: gen(),
    });
    expect(resp.status).toBe(200);
    // The body is a ReadableStream — confirm via the Response API.
    expect(resp.body).not.toBeNull();
    const text = await resp.text();
    expect(text).toBe('{"id":"a"}\n{"id":"b"}\n');
  });

  it('propagates iterator errors to the stream consumer', async () => {
    async function* gen(): AsyncIterable<string> {
      yield '{"id":"a"}\n';
      throw new Error('source failure');
    }
    const resp = toFetchResponse({
      status: 200,
      headers: new Headers(),
      body: gen(),
    });
    await expect(resp.text()).rejects.toThrow();
  });
});
