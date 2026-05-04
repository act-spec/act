/**
 * PRD-500-R29 — discovery hand-off Link header tests.
 */
import { describe, expect, it } from 'vitest';

import { actLinkHeaderMiddleware, buildDiscoveryLink } from './discovery.js';
import type { ActRequest } from './types.js';

function fakeRequest(): ActRequest {
  return {
    method: 'GET',
    url: new URL('http://example.com/some/path'),
    headers: new Headers(),
    getCookie: () => undefined,
  };
}

describe('PRD-500-R29 / PRD-106-R23: buildDiscoveryLink', () => {
  it('emits the canonical link string with default well-known path', () => {
    expect(buildDiscoveryLink('', '/.well-known/act.json')).toBe(
      '</.well-known/act.json>; rel="act"; type="application/act-manifest+json"; profile="runtime"',
    );
  });

  it('prefixes the basePath when configured (PRD-500-R26)', () => {
    expect(buildDiscoveryLink('/app', '/.well-known/act.json')).toBe(
      '</app/.well-known/act.json>; rel="act"; type="application/act-manifest+json"; profile="runtime"',
    );
  });

  it('honors a non-default well-known path', () => {
    expect(buildDiscoveryLink('', '/act.json')).toBe(
      '</act.json>; rel="act"; type="application/act-manifest+json"; profile="runtime"',
    );
  });
});

describe('PRD-500-R29: actLinkHeaderMiddleware', () => {
  it('returns a function that emits the Link header on a Headers object', () => {
    const mw = actLinkHeaderMiddleware();
    const headers = mw(fakeRequest());
    expect(headers.get('Link')).toBe(
      '</.well-known/act.json>; rel="act"; type="application/act-manifest+json"; profile="runtime"',
    );
  });

  it('honors basePath + custom well-known path', () => {
    const mw = actLinkHeaderMiddleware({ basePath: '/api', wellKnownPath: '/act.json' });
    const headers = mw(fakeRequest());
    expect(headers.get('Link')).toBe(
      '</api/act.json>; rel="act"; type="application/act-manifest+json"; profile="runtime"',
    );
  });

  it('does not vary Link by request (it is configuration-only)', () => {
    const mw = actLinkHeaderMiddleware({ basePath: '/x' });
    const a = mw(fakeRequest()).get('Link');
    const b = mw({ ...fakeRequest(), method: 'POST' }).get('Link');
    expect(a).toBe(b);
  });
});
