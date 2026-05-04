/**
 * Tests for URI builder and parser per PRD-602-R6 / R7 / R11 and the
 * security-section reserved-character `host` check.
 */
import { describe, expect, it } from 'vitest';

import {
  buildManifestUri,
  buildResourceUri,
  buildSubtreeUri,
  encodePrefixSegments,
  isValidMcpHost,
  resolveMountByPath,
} from './uri.js';

describe('PRD-602-R6 single-mount URI form', () => {
  it('builds act://<host>/<id> when mountPrefix is null', () => {
    expect(buildResourceUri('docs.example.com', null, 'getting-started/install')).toBe(
      'act://docs.example.com/getting-started/install',
    );
  });

  it('builds act://<host>/<id> when mountPrefix is "/" (root)', () => {
    expect(buildResourceUri('docs.example.com', '/', 'a/b')).toBe('act://docs.example.com/a/b');
  });

  it('per-segment percent-encodes ids preserving "/" as separator', () => {
    expect(buildResourceUri('h', null, 'a/hello world')).toBe('act://h/a/hello%20world');
  });
});

describe('PRD-602-R6 multi-mount URI form', () => {
  it('interleaves the encoded prefix between host and id', () => {
    expect(buildResourceUri('acme.com', '/marketing', 'landing')).toBe(
      'act://acme.com/marketing/landing',
    );
    expect(buildResourceUri('acme.com', '/app', 'dashboard')).toBe(
      'act://acme.com/app/dashboard',
    );
  });

  it('per-segment encodes nested prefix segments', () => {
    expect(buildResourceUri('h', '/api/v1', 'resource')).toBe('act://h/api/v1/resource');
    expect(buildResourceUri('h', '/marketing/landing pages', 'x')).toBe(
      'act://h/marketing/landing%20pages/x',
    );
  });

  it('strips leading and trailing slashes on prefix', () => {
    expect(encodePrefixSegments('//a//b/')).toBe('a/b');
  });
});

describe('PRD-602-R7 manifest URI', () => {
  it('single-mount yields act://<host>/manifest', () => {
    expect(buildManifestUri('h', null)).toBe('act://h/manifest');
  });

  it('multi-mount yields act://<host>/<prefix>/manifest per mount', () => {
    expect(buildManifestUri('h', '/marketing')).toBe('act://h/marketing/manifest');
    expect(buildManifestUri('h', '/app')).toBe('act://h/app/manifest');
  });
});

describe('PRD-602-R11 subtree URI', () => {
  it('single-mount yields act://<host>/<id>?subtree=1', () => {
    expect(buildSubtreeUri('h', null, 'root')).toBe('act://h/root?subtree=1');
  });

  it('multi-mount yields act://<host>/<prefix>/<id>?subtree=1', () => {
    expect(buildSubtreeUri('h', '/app', 'root')).toBe('act://h/app/root?subtree=1');
  });
});

describe('PRD-602 Security: isValidMcpHost (URI scheme injection)', () => {
  it('accepts unreserved hosts', () => {
    expect(isValidMcpHost('docs.example.com')).toBe(true);
    expect(isValidMcpHost('localhost')).toBe(true);
    expect(isValidMcpHost('a-b_c.tld')).toBe(true);
  });

  it('accepts hosts with explicit port', () => {
    expect(isValidMcpHost('localhost:3000')).toBe(true);
  });

  it('rejects empty host', () => {
    expect(isValidMcpHost('')).toBe(false);
  });

  it('rejects host with reserved characters (path/query/fragment/userinfo/whitespace)', () => {
    expect(isValidMcpHost('h/path')).toBe(false);
    expect(isValidMcpHost('h?q=1')).toBe(false);
    expect(isValidMcpHost('h#frag')).toBe(false);
    expect(isValidMcpHost('user@h')).toBe(false);
    expect(isValidMcpHost('h ost')).toBe(false);
  });

  it('rejects host with scheme-shadowing chars', () => {
    expect(isValidMcpHost('act://x')).toBe(false);
  });
});

describe('PRD-106-R20 resolveMountByPath: longest-prefix match', () => {
  it('returns the longest matching mount prefix', () => {
    const result = resolveMountByPath('app/v2/foo', ['/app', '/app/v2']);
    expect(result).toEqual({ matchedPrefix: '/app/v2', remainder: 'foo' });
  });

  it('matches root prefix as fallback', () => {
    const result = resolveMountByPath('any/id', ['/']);
    expect(result).toEqual({ matchedPrefix: '/', remainder: 'any/id' });
  });

  it('returns null when no mount matches', () => {
    expect(resolveMountByPath('marketing/landing', ['/app'])).toBeNull();
  });

  it('returns the bare-prefix match (remainder empty)', () => {
    expect(resolveMountByPath('app', ['/app'])).toEqual({
      matchedPrefix: '/app',
      remainder: '',
    });
  });
});
