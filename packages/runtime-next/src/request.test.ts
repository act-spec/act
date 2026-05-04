/**
 * PRD-501-R5 — request normalization tests for both App Router (WHATWG
 * `Request`) and Pages Router (Node-style request) paths. Verifies
 * cookie accessor, header passthrough, URL construction, and method
 * normalization.
 */
import { describe, expect, it } from 'vitest';

import { fromAppRouter, fromPagesRouter } from './request.js';
import type { PagesApiRequestLike } from './types.js';

describe('PRD-501-R5: App Router request normalization', () => {
  it('normalizes method, url, and headers from a WHATWG Request', () => {
    const req = new Request('https://example.com/act/index.json', {
      method: 'GET',
      headers: { 'x-test': 'present' },
    });
    const actReq = fromAppRouter(req);
    expect(actReq.method).toBe('GET');
    expect(actReq.url.pathname).toBe('/act/index.json');
    expect(actReq.headers.get('x-test')).toBe('present');
  });

  it('reads cookies from the Next.js RequestCookies accessor when present', () => {
    const baseReq = new Request('https://example.com/act/index.json');
    // Simulate Next.js's RequestCookies attachment.
    Object.defineProperty(baseReq, 'cookies', {
      value: {
        get(name: string) {
          if (name === 'session') return { name, value: 'abc' };
          return undefined;
        },
      },
    });
    const actReq = fromAppRouter(baseReq);
    expect(actReq.getCookie('session')).toBe('abc');
    expect(actReq.getCookie('missing')).toBeUndefined();
  });

  it('falls back to parsing the Cookie header when no cookie store attached', () => {
    const req = new Request('https://example.com/act/index.json', {
      headers: { cookie: 'session=xyz; theme=dark' },
    });
    const actReq = fromAppRouter(req);
    expect(actReq.getCookie('session')).toBe('xyz');
    expect(actReq.getCookie('theme')).toBe('dark');
    expect(actReq.getCookie('missing')).toBeUndefined();
  });

  it('rejects malformed cookie segments (no = sign)', () => {
    const req = new Request('https://example.com/', {
      headers: { cookie: 'malformed; ok=yes' },
    });
    const actReq = fromAppRouter(req);
    expect(actReq.getCookie('ok')).toBe('yes');
    expect(actReq.getCookie('malformed')).toBeUndefined();
  });

  it('returns undefined when no cookies and no Cookie header', () => {
    const req = new Request('https://example.com/');
    const actReq = fromAppRouter(req);
    expect(actReq.getCookie('anything')).toBeUndefined();
  });

  it('coerces unknown HTTP methods to GET (admit-list)', () => {
    const req = new Request('https://example.com/');
    Object.defineProperty(req, 'method', { value: 'WEIRD' });
    const actReq = fromAppRouter(req);
    expect(actReq.method).toBe('GET');
  });
});

describe('PRD-501-R20: Pages Router request normalization', () => {
  function pagesReq(overrides: Partial<PagesApiRequestLike> = {}): PagesApiRequestLike {
    return {
      method: 'GET',
      url: '/act/index.json',
      headers: { host: 'example.com' },
      query: {},
      ...overrides,
    };
  }

  it('normalizes a Pages-style request to ActRequest', () => {
    const req = pagesReq({ headers: { host: 'example.com', 'x-flag': '1' } });
    const actReq = fromPagesRouter(req, 'example.com');
    expect(actReq.method).toBe('GET');
    expect(actReq.url.pathname).toBe('/act/index.json');
    expect(actReq.url.host).toBe('example.com');
    expect(actReq.headers.get('x-flag')).toBe('1');
  });

  it('reads cookies from the Node-style req.cookies record', () => {
    const req = pagesReq({ cookies: { session: 'page-cookie' } });
    const actReq = fromPagesRouter(req, 'example.com');
    expect(actReq.getCookie('session')).toBe('page-cookie');
  });

  it('falls back to Cookie header when req.cookies is missing', () => {
    const req = pagesReq({ headers: { host: 'example.com', cookie: 'a=b' } });
    const actReq = fromPagesRouter(req, 'example.com');
    expect(actReq.getCookie('a')).toBe('b');
  });

  it('handles repeated header values (set-cookie array)', () => {
    const req = pagesReq({
      headers: { host: 'example.com', 'x-multi': ['a', 'b'] },
    });
    const actReq = fromPagesRouter(req, 'example.com');
    expect(actReq.headers.get('x-multi')).toContain('a');
  });

  it('coerces unknown HTTP methods to GET', () => {
    const req = pagesReq({ method: 'WEIRD' });
    const actReq = fromPagesRouter(req, 'example.com');
    expect(actReq.method).toBe('GET');
  });

  it('handles undefined header values (skipped)', () => {
    const req = pagesReq({ headers: { host: 'example.com', 'x-undef': undefined } });
    const actReq = fromPagesRouter(req, 'example.com');
    expect(actReq.headers.has('x-undef')).toBe(false);
  });
});
