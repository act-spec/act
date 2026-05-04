// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { detectEnvelopeKind, looksLikeNdjson, looksLikeUrl } from './detect.js';

describe('looksLikeUrl', () => {
  it('accepts http and https URLs', () => {
    expect(looksLikeUrl('http://example.com')).toBe(true);
    expect(looksLikeUrl('https://example.com/.well-known/act.json')).toBe(true);
    expect(looksLikeUrl('  https://acme.test  ')).toBe(true);
  });

  it('rejects non-http schemes and raw paste', () => {
    expect(looksLikeUrl('file:///tmp/manifest.json')).toBe(false);
    expect(looksLikeUrl('data:application/json,{}')).toBe(false);
    expect(looksLikeUrl('{}')).toBe(false);
    expect(looksLikeUrl('not a url at all')).toBe(false);
    expect(looksLikeUrl('')).toBe(false);
  });

  it('rejects malformed http strings', () => {
    expect(looksLikeUrl('https://')).toBe(false);
  });
});

describe('looksLikeNdjson', () => {
  it('detects multi-line JSON', () => {
    expect(looksLikeNdjson('{"a":1}\n{"b":2}')).toBe(true);
    expect(looksLikeNdjson('{"a":1}\n{"b":2}\n')).toBe(true);
    expect(looksLikeNdjson('{"a":1}\n\n{"b":2}\n')).toBe(true);
  });

  it('rejects single-line JSON (would be regular envelope)', () => {
    expect(looksLikeNdjson('{"a":1}')).toBe(false);
  });

  it('rejects multi-line non-JSON', () => {
    expect(looksLikeNdjson('hello\nworld')).toBe(false);
    expect(looksLikeNdjson('{"a":1}\nnot-json')).toBe(false);
  });
});

describe('detectEnvelopeKind', () => {
  it('NDJSON wins over object detection', () => {
    expect(detectEnvelopeKind('{"id":"a"}\n{"id":"b"}').kind).toBe('ndjson');
  });

  it('manifest detected by node_url_template / index_url', () => {
    expect(
      detectEnvelopeKind('{"act_version":"0.1","node_url_template":"/n/{id}.json"}').kind,
    ).toBe('manifest');
    expect(
      detectEnvelopeKind('{"act_version":"0.1","index_url":"/i.json"}').kind,
    ).toBe('manifest');
  });

  it('error envelope detected by top-level `error` object', () => {
    expect(
      detectEnvelopeKind(
        '{"act_version":"0.1","error":{"code":"not_found","message":"x"}}',
      ).kind,
    ).toBe('error');
  });

  it('subtree detected by depth + nodes + root', () => {
    expect(
      detectEnvelopeKind(
        '{"act_version":"0.1","depth":2,"root":"a","nodes":[],"etag":"s256:AAAAAAAAAAAAAAAAAAAAAA"}',
      ).kind,
    ).toBe('subtree');
  });

  it('index detected by nodes[] in absence of depth/root', () => {
    expect(
      detectEnvelopeKind(
        '{"act_version":"0.1","nodes":[{"id":"a","etag":"s256:AAAAAAAAAAAAAAAAAAAAAA"}]}',
      ).kind,
    ).toBe('index');
  });

  it('node fallback for typical node-shaped paste', () => {
    expect(
      detectEnvelopeKind(
        '{"act_version":"0.1","id":"a","etag":"s256:AAAAAAAAAAAAAAAAAAAAAA","content":[]}',
      ).kind,
    ).toBe('node');
  });

  it('falls through to node for unparseable JSON (validator surfaces the error)', () => {
    expect(detectEnvelopeKind('not-json').kind).toBe('node');
  });

  it('falls through to node for non-object JSON', () => {
    expect(detectEnvelopeKind('"a string"').kind).toBe('node');
    expect(detectEnvelopeKind('42').kind).toBe('node');
    expect(detectEnvelopeKind('null').kind).toBe('node');
  });

  it('treats error-shaped non-object value as node fallback', () => {
    // top-level `error` must be an object — string values fall through.
    expect(
      detectEnvelopeKind('{"act_version":"0.1","error":"oops"}').kind,
    ).toBe('node');
  });
});
