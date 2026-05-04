import { describe, expect, it } from 'vitest';
import {
  RequestBudget,
  RequestBudgetExceededError,
  resolveManifestUrl,
  resolveUrlAgainst,
  substituteId,
  InvocationCache,
  toFinding,
  isSameRegistrableDomain,
} from './http.js';

describe('RequestBudget (PRD-601-R20)', () => {
  it('counts requests and exposes a summary', async () => {
    const fetcher: typeof globalThis.fetch = async () => new Response('ok');
    const b = new RequestBudget(2, fetcher);
    await b.fetch('http://example.invalid/a');
    await b.fetch('http://example.invalid/b');
    expect(b.summary().requests_made).toBe(2);
  });

  it('throws RequestBudgetExceededError when over the cap', async () => {
    const fetcher: typeof globalThis.fetch = async () => new Response('ok');
    const b = new RequestBudget(1, fetcher);
    await b.fetch('http://example.invalid/a');
    await expect(b.fetch('http://example.invalid/b')).rejects.toBeInstanceOf(RequestBudgetExceededError);
  });
});

describe('resolveManifestUrl (PRD-101-R1)', () => {
  it('returns a well-known URL unchanged', () => {
    const u = 'https://acme.example/.well-known/act.json';
    expect(resolveManifestUrl(u)).toBe(u);
  });

  it('appends the well-known path to a bare origin', () => {
    expect(resolveManifestUrl('https://acme.example')).toBe('https://acme.example/.well-known/act.json');
  });

  it('overrides any non-well-known path', () => {
    expect(resolveManifestUrl('https://acme.example/foo')).toBe('https://acme.example/.well-known/act.json');
  });

  it('falls through unchanged on a non-URL string', () => {
    expect(resolveManifestUrl('not a url')).toBe('not a url');
  });
});

describe('resolveUrlAgainst', () => {
  it('makes a relative URL absolute', () => {
    expect(resolveUrlAgainst('https://acme.example/x', '/y/z')).toBe('https://acme.example/y/z');
  });

  it('returns absolute URLs verbatim', () => {
    expect(resolveUrlAgainst('https://acme.example', 'https://other.example/y')).toBe('https://other.example/y');
  });

  it('falls back to the input when base is invalid', () => {
    expect(resolveUrlAgainst('not-a-url', 'still-not-a-url')).toBe('still-not-a-url');
  });
});

describe('substituteId (PRD-100-R26 spirit)', () => {
  it('substitutes {id} as percent-encoded but preserves slashes', () => {
    expect(substituteId('/n/{id}.json', 'docs/intro')).toBe('/n/docs/intro.json');
  });

  it('encodes special characters', () => {
    expect(substituteId('/n/{id}.json', 'a b')).toBe('/n/a%20b.json');
  });
});

describe('InvocationCache (PRD-601-R9)', () => {
  it('records ETags on 200 responses and replays them per URL', () => {
    const c = new InvocationCache();
    c.rememberFromResponse('http://x/a', new Response('ok', { status: 200, headers: { etag: 's256:abc' } }));
    expect(c.ifNoneMatchFor('http://x/a')).toBe('s256:abc');
  });

  it('does NOT record ETags on non-2xx responses', () => {
    const c = new InvocationCache();
    c.rememberFromResponse('http://x/a', new Response('not found', { status: 404, headers: { etag: 's256:abc' } }));
    expect(c.ifNoneMatchFor('http://x/a')).toBeUndefined();
  });

  it('clear() empties the cache', () => {
    const c = new InvocationCache();
    c.rememberFromResponse('http://x/a', new Response('ok', { status: 200, headers: { etag: 's256:abc' } }));
    c.clear();
    expect(c.ifNoneMatchFor('http://x/a')).toBeUndefined();
  });
});

describe('toFinding', () => {
  it('lifts an Error', () => {
    const f = toFinding('boom', new Error('kaboom'));
    expect(f.code).toBe('boom');
    expect(f.message).toBe('kaboom');
    expect(f.severity).toBe('error');
  });

  it('stringifies non-Errors', () => {
    const f = toFinding('boom', 'string-error', 'warn');
    expect(f.message).toBe('string-error');
    expect(f.severity).toBe('warn');
  });
});

describe('isSameRegistrableDomain (PRD-601-R8)', () => {
  it('returns true for the same hostname', () => {
    expect(isSameRegistrableDomain('https://acme.example/a', 'https://acme.example/b')).toBe(true);
  });

  it('returns true for subdomain pairs sharing the top-two labels', () => {
    expect(isSameRegistrableDomain('https://app.acme.example', 'https://docs.acme.example')).toBe(true);
  });

  it('returns false across registrable domains', () => {
    expect(isSameRegistrableDomain('https://acme.example', 'https://partner.example')).toBe(false);
  });

  it('falls back to literal equality for non-URLs', () => {
    expect(isSameRegistrableDomain('not-a-url', 'not-a-url')).toBe(true);
    expect(isSameRegistrableDomain('not-a-url', 'other')).toBe(false);
  });
});
