/**
 * PRD-502-R10 — response wiring tests.
 *
 * Each test cites the requirement it enforces.
 */
import { describe, expect, it } from 'vitest';
import type { ActResponse } from '@act-spec/runtime-core';

import { writeExpress } from './response.js';
import { recordingResponse } from './_fixtures.js';

describe('PRD-502-R10: response wiring (writeExpress)', () => {
  it('writes a string body via res.send and sets status', async () => {
    const res = recordingResponse();
    const actResp: ActResponse = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/act-node+json; profile=runtime' }),
      body: '{"ok":true}',
    };
    await writeExpress(res, actResp);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"ok":true}');
    expect(res.collectedHeaders.get('content-type')?.[0]).toContain('act-node');
  });

  it('handles a 304 / null body via res.end', async () => {
    const res = recordingResponse();
    const actResp: ActResponse = {
      status: 304,
      headers: new Headers({ etag: '"abc"' }),
      body: null,
    };
    await writeExpress(res, actResp);
    expect(res.statusCode).toBe(304);
    expect(res.body).toBe('');
    expect(res.ended).toBe(true);
  });

  it('streams an AsyncIterable body line-by-line via res.write + res.end (NDJSON)', async () => {
    const res = recordingResponse();
    async function* lines(): AsyncIterable<string> {
      yield '{"id":"a"}\n';
      yield '{"id":"b"}\n';
    }
    const actResp: ActResponse = {
      status: 200,
      headers: new Headers({
        'content-type': 'application/act-index+json; profile=ndjson; profile=runtime',
      }),
      body: lines(),
    };
    await writeExpress(res, actResp);
    expect(res.headersFlushed).toBe(true);
    expect(res.body).toBe('{"id":"a"}\n{"id":"b"}\n');
    expect(res.ended).toBe(true);
  });

  it('forwards every ActResponse header to res.setHeader', async () => {
    const res = recordingResponse();
    const headers = new Headers();
    headers.set('content-type', 'application/act-manifest+json; profile=runtime');
    headers.set('etag', '"abcdef"');
    headers.set('cache-control', 'private, max-age=0, must-revalidate');
    headers.set('vary', 'accept, authorization');
    headers.set('link', '</.well-known/act.json>; rel="act"');
    const actResp: ActResponse = { status: 200, headers, body: '{}' };
    await writeExpress(res, actResp);
    expect(res.collectedHeaders.get('etag')?.[0]).toBe('"abcdef"');
    expect(res.collectedHeaders.get('cache-control')?.[0]).toContain('private');
    expect(res.collectedHeaders.get('vary')?.[0]).toContain('accept');
    expect(res.collectedHeaders.get('link')?.[0]).toContain('rel="act"');
  });

  it('short-circuits when res.headersSent is already true', async () => {
    const res = recordingResponse();
    res.headersSent = true;
    const actResp: ActResponse = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: '{"x":1}',
    };
    await writeExpress(res, actResp);
    expect(res.statusCode).toBe(0);
    expect(res.body).toBe('');
  });

  it('omits flushHeaders call when the impl does not provide it', async () => {
    const res = recordingResponse();
    // Simulate a response that does not implement flushHeaders.
    delete (res as { flushHeaders?: () => void }).flushHeaders;
    async function* lines(): AsyncIterable<string> {
      yield 'one\n';
    }
    const actResp: ActResponse = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/act-index+json; profile=ndjson' }),
      body: lines(),
    };
    await writeExpress(res, actResp);
    expect(res.body).toBe('one\n');
    expect(res.ended).toBe(true);
  });
});
