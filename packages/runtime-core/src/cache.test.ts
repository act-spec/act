/**
 * PRD-500-R22 — Cache-Control + Vary tests.
 */
import { describe, expect, it } from 'vitest';

import { applyCacheHeaders, cacheControlFor, varyFor } from './cache.js';
import type { Manifest } from './types.js';

const cookieManifest: Manifest = {
  act_version: '0.1',
  site: { name: 'cookies.example' },
  delivery: 'runtime',
  conformance: { level: 'core' },
  index_url: '/i.json',
  node_url_template: '/n/{id}.json',
  auth: { schemes: ['cookie'] },
} as Manifest;

const bearerManifest: Manifest = { ...cookieManifest, auth: { schemes: ['bearer'] } } as Manifest;

const noAuthManifest: Manifest = {
  act_version: '0.1',
  site: { name: 'pub.example' },
  delivery: 'runtime',
  conformance: { level: 'core' },
  index_url: '/i.json',
  node_url_template: '/n/{id}.json',
} as Manifest;

describe('PRD-500-R22: cacheControlFor', () => {
  it('emits private, must-revalidate for principals', () => {
    expect(cacheControlFor({ kind: 'principal', key: 'u1' }, { kind: 'single' }, 0)).toBe(
      'private, must-revalidate',
    );
  });

  it('emits public max-age=N for anonymous + single tenant', () => {
    expect(cacheControlFor({ kind: 'anonymous' }, { kind: 'single' }, 60)).toBe(
      'public, max-age=60',
    );
  });

  it('emits public max-age=N for anonymous + scoped tenant (Vary handled separately)', () => {
    expect(cacheControlFor({ kind: 'anonymous' }, { kind: 'scoped', key: 'acme' }, 30)).toBe(
      'public, max-age=30',
    );
  });

  it('does not emit `private` on anonymous responses (PRD-500-R22 explicit)', () => {
    expect(cacheControlFor({ kind: 'anonymous' }, { kind: 'single' }, 0)).not.toContain('private');
  });
});

describe('PRD-500-R22: varyFor', () => {
  it('emits Vary: Cookie when manifest primary scheme is cookie', () => {
    expect(varyFor({ kind: 'principal', key: 'u1' }, cookieManifest)).toBe('Cookie');
  });

  it('emits Vary: Authorization when manifest primary scheme is bearer', () => {
    expect(varyFor({ kind: 'principal', key: 'u1' }, bearerManifest)).toBe('Authorization');
  });

  it('returns null for anonymous identities (no per-request Vary from PRD-500)', () => {
    expect(varyFor({ kind: 'anonymous' }, bearerManifest)).toBeNull();
  });

  it('falls back to Authorization when no auth declared (defensive)', () => {
    expect(varyFor({ kind: 'principal', key: 'u1' }, noAuthManifest)).toBe('Authorization');
  });
});

describe('PRD-500-R22: applyCacheHeaders', () => {
  it('sets both Cache-Control and Vary on a principal response', () => {
    const h = new Headers();
    applyCacheHeaders(h, { kind: 'principal', key: 'u1' }, { kind: 'single' }, bearerManifest, 0);
    expect(h.get('Cache-Control')).toBe('private, must-revalidate');
    expect(h.get('Vary')).toBe('Authorization');
  });

  it('sets only Cache-Control on an anonymous response (no SDK Vary)', () => {
    const h = new Headers();
    applyCacheHeaders(h, { kind: 'anonymous' }, { kind: 'single' }, bearerManifest, 60);
    expect(h.get('Cache-Control')).toBe('public, max-age=60');
    expect(h.get('Vary')).toBeNull();
  });
});
