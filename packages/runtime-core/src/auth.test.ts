/**
 * PRD-500-R14 — `buildAuthChallenges` tests.
 */
import { describe, expect, it } from 'vitest';

import { buildAuthChallenges } from './auth.js';
import type { Manifest } from './types.js';

function manifestWithAuth(auth: Manifest['auth']): Manifest {
  return {
    act_version: '0.1',
    site: { name: 'test.example' },
    delivery: 'runtime',
    conformance: { level: 'core' },
    index_url: '/i.json',
    node_url_template: '/n/{id}.json',
    auth,
  } as Manifest;
}

describe('PRD-500-R14: buildAuthChallenges', () => {
  it('returns one challenge per scheme in declared order', () => {
    const m = manifestWithAuth({ schemes: ['cookie', 'bearer'] });
    const out = buildAuthChallenges(m);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('Cookie realm="test.example"');
    expect(out[1]).toBe('Bearer realm="test.example"');
  });

  it('emits oauth2 challenge with scope and authorization_uri', () => {
    const m = manifestWithAuth({
      schemes: ['oauth2'],
      oauth2: {
        authorization_endpoint: 'https://example.com/auth',
        token_endpoint: 'https://example.com/token',
        scopes_supported: ['act.read', 'act.write'],
      },
    });
    const out = buildAuthChallenges(m);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(
      'Bearer realm="test.example", error="invalid_token", scope="act.read act.write", authorization_uri="https://example.com/auth"',
    );
  });

  it('emits api_key as Bearer realm per PRD-106-R10 default', () => {
    const m = manifestWithAuth({ schemes: ['api_key'] });
    expect(buildAuthChallenges(m)).toEqual(['Bearer realm="test.example"']);
  });

  it('returns [] when no auth block is declared (anonymous public access)', () => {
    const m: Manifest = {
      act_version: '0.1',
      site: { name: 'pub.example' },
      delivery: 'runtime',
      conformance: { level: 'core' },
      index_url: '/i.json',
      node_url_template: '/n/{id}.json',
    } as Manifest;
    expect(buildAuthChallenges(m)).toEqual([]);
  });

  it('returns [] when schemes is empty', () => {
    // The codegen'd Manifest type requires a non-empty schemes array, but
    // guarding is defensive against hand-built manifests in tests.
    const m = manifestWithAuth({ schemes: [] as unknown as ['cookie'] });
    expect(buildAuthChallenges(m)).toEqual([]);
  });

  it('emits a defensive oauth2 challenge when oauth2 fields are missing', () => {
    // Construction-time validation should prevent this; the helper stays
    // total per PRD-500-R14's "function of manifest" rule.
    const m = manifestWithAuth({ schemes: ['oauth2'] });
    const out = buildAuthChallenges(m);
    expect(out[0]).toContain('Bearer realm="test.example"');
    expect(out[0]).toContain('invalid_token');
  });

  it('PRD-500-R14: challenge set is a function of the manifest, not the URL', () => {
    // Documents the negative fixture's failure mode: callers MUST NOT pass a
    // URL into this helper; the helper signature only accepts the manifest.
    const m = manifestWithAuth({ schemes: ['cookie'] });
    const out1 = buildAuthChallenges(m);
    const out2 = buildAuthChallenges(m);
    expect(out1).toEqual(out2);
  });
});
