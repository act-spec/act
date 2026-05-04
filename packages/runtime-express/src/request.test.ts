/**
 * PRD-502-R5 — request normalization tests.
 *
 * Each test cites the requirement it enforces.
 */
import { describe, expect, it } from 'vitest';

import { fromExpress } from './request.js';
import type { ExpressRequestLike } from './types.js';

describe('PRD-502-R5: request normalization (fromExpress)', () => {
  it('maps method, headers, and url from an Express request', () => {
    const req: ExpressRequestLike = {
      method: 'GET',
      url: '/act/index.json',
      originalUrl: '/act/index.json',
      protocol: 'http',
      headers: { host: 'example.com', authorization: 'Bearer t' },
    };
    const actReq = fromExpress(req);
    expect(actReq.method).toBe('GET');
    expect(actReq.url.toString()).toBe('http://example.com/act/index.json');
    expect(actReq.headers.get('authorization')).toBe('Bearer t');
  });

  it('uses originalUrl (NOT url) so the mount-prefix is preserved', () => {
    // When `app.use('/app', actRouter(...))` is mounted, Express strips
    // `/app` from `req.url` but `originalUrl` retains it. PRD-502-R5
    // mandates we use `originalUrl`.
    const req: ExpressRequestLike = {
      method: 'GET',
      url: '/act/index.json',
      originalUrl: '/app/act/index.json',
      protocol: 'http',
      headers: { host: 'example.com' },
    };
    const actReq = fromExpress(req);
    expect(actReq.url.pathname).toBe('/app/act/index.json');
  });

  it('falls back to req.url when originalUrl is missing', () => {
    const req: ExpressRequestLike = {
      method: 'GET',
      url: '/act/index.json',
      protocol: 'http',
      headers: { host: 'example.com' },
    };
    const actReq = fromExpress(req);
    expect(actReq.url.pathname).toBe('/act/index.json');
  });

  it('flattens array-valued headers into multiple appends', () => {
    const req: ExpressRequestLike = {
      method: 'GET',
      originalUrl: '/act/index.json',
      protocol: 'http',
      headers: { host: 'example.com', accept: ['text/html', 'application/json'] },
    };
    const actReq = fromExpress(req);
    // Headers.get returns comma-joined values for multi-value.
    expect(actReq.headers.get('accept')).toContain('application/json');
  });

  it('reads cookies from req.cookies (cookie-parser pattern)', () => {
    const req: ExpressRequestLike = {
      method: 'GET',
      originalUrl: '/act/index.json',
      protocol: 'http',
      headers: { host: 'example.com' },
      cookies: { 'connect.sid': 'abc-123' },
    };
    const actReq = fromExpress(req);
    expect(actReq.getCookie('connect.sid')).toBe('abc-123');
  });

  it('falls back to parsing the Cookie header when req.cookies is absent', () => {
    const req: ExpressRequestLike = {
      method: 'GET',
      originalUrl: '/act/index.json',
      protocol: 'http',
      headers: {
        host: 'example.com',
        cookie: 'connect.sid=xyz-456; theme=dark',
      },
    };
    const actReq = fromExpress(req);
    expect(actReq.getCookie('connect.sid')).toBe('xyz-456');
    expect(actReq.getCookie('theme')).toBe('dark');
    expect(actReq.getCookie('absent')).toBeUndefined();
  });

  it('handles array-valued Cookie header by joining', () => {
    const req: ExpressRequestLike = {
      method: 'GET',
      originalUrl: '/act/index.json',
      protocol: 'http',
      headers: { host: 'example.com', cookie: ['a=1', 'b=2'] as string[] },
    };
    const actReq = fromExpress(req);
    expect(actReq.getCookie('a')).toBe('1');
    expect(actReq.getCookie('b')).toBe('2');
  });

  it('returns undefined for cookies when no cookie state exists', () => {
    const req: ExpressRequestLike = {
      method: 'GET',
      originalUrl: '/',
      protocol: 'http',
      headers: { host: 'example.com' },
    };
    const actReq = fromExpress(req);
    expect(actReq.getCookie('anything')).toBeUndefined();
  });

  it('uses req.get(host) when present, falls back to req.headers.host', () => {
    const reqWithGet: ExpressRequestLike = {
      method: 'GET',
      originalUrl: '/',
      protocol: 'http',
      headers: { host: 'header-host.example' },
      get(name: string): string | undefined {
        if (name.toLowerCase() === 'host') return 'getter-host.example';
        return undefined;
      },
    };
    expect(fromExpress(reqWithGet).url.host).toBe('getter-host.example');

    const reqNoGet: ExpressRequestLike = {
      method: 'GET',
      originalUrl: '/',
      protocol: 'http',
      headers: { host: 'header-host.example' },
    };
    expect(fromExpress(reqNoGet).url.host).toBe('header-host.example');
  });

  it('defaults to localhost when no host is supplied (URL is parseable)', () => {
    const req: ExpressRequestLike = {
      method: 'GET',
      originalUrl: '/',
      protocol: 'http',
      headers: {},
    };
    expect(fromExpress(req).url.host).toBe('localhost');
  });

  it('admit-lists HTTP methods; unknown values fall back to GET', () => {
    const req: ExpressRequestLike = {
      method: 'CHEESE',
      originalUrl: '/',
      protocol: 'http',
      headers: { host: 'example.com' },
    };
    expect(fromExpress(req).method).toBe('GET');
  });

  it('upper-cases lowercase methods', () => {
    const req: ExpressRequestLike = {
      method: 'post',
      originalUrl: '/',
      protocol: 'http',
      headers: { host: 'example.com' },
    };
    expect(fromExpress(req).method).toBe('POST');
  });

  it('defaults protocol to http when missing', () => {
    const req: ExpressRequestLike = {
      method: 'GET',
      originalUrl: '/',
      headers: { host: 'example.com' },
    };
    expect(fromExpress(req).url.protocol).toBe('http:');
  });

  it('skips undefined header values during normalization', () => {
    const req: ExpressRequestLike = {
      method: 'GET',
      originalUrl: '/',
      protocol: 'http',
      headers: { host: 'example.com', 'x-undefined': undefined },
    };
    const actReq = fromExpress(req);
    expect(actReq.headers.get('x-undefined')).toBeNull();
  });

  it('handles array-valued host header', () => {
    const req: ExpressRequestLike = {
      method: 'GET',
      originalUrl: '/',
      protocol: 'http',
      headers: { host: ['arr-host.example', 'second.example'] as string[] },
    };
    expect(fromExpress(req).url.host).toBe('arr-host.example');
  });

  it('tolerates malformed cookie segments', () => {
    const req: ExpressRequestLike = {
      method: 'GET',
      originalUrl: '/',
      protocol: 'http',
      headers: { host: 'example.com', cookie: '; =bad; valid=ok; ; nokey' },
    };
    const actReq = fromExpress(req);
    expect(actReq.getCookie('valid')).toBe('ok');
    expect(actReq.getCookie('bad')).toBeUndefined();
  });
});
