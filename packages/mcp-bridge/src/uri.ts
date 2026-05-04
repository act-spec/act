/**
 * PRD-602-R6 — `act://` URI builder, parser, and host validation.
 *
 * Two canonical forms:
 *  - Single-mount: `act://<host>/<percent-encoded-id>`.
 *  - Multi-mount:  `act://<host>/<percent-encoded-prefix-segments>/<percent-encoded-id>`.
 *
 * The mount prefix is taken from `BridgeConfig.mounts[i].prefix` with the
 * leading `/` stripped and per-segment percent-encoded; per-segment
 * encoding preserves `/` as the segment separator (PRD-100-R12 /
 * PRD-106-R14 / PRD-500-R13). The builder reuses
 * `encodeIdForUrl` from `@act-spec/runtime-core`.
 *
 * The reserved-character `host` check (PRD-602 Security
 * §"URI scheme injection") rejects any host containing characters outside
 * RFC 3986's `reg-name` production (unreserved + sub-delims + percent).
 * The bridge throws at `createBridge`; this module surfaces the predicate.
 */
import { encodeIdForUrl } from '@act-spec/runtime-core';

/** Synthetic id used for the per-mount manifest resource (PRD-602-R7). */
export const MANIFEST_RESOURCE_ID = 'manifest' as const;

/**
 * Per-segment percent-encode a mount prefix.
 *
 *   '/' → ''           (root prefix produces no segments — single-mount form)
 *   '/marketing' → 'marketing'
 *   '/api/v1' → 'api/v1'
 *
 * Empty segments (caused by leading/trailing/double slashes) are stripped
 * to preserve segment-only output.
 */
export function encodePrefixSegments(prefix: string): string {
  if (prefix === '' || prefix === '/') return '';
  const stripped = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  if (stripped === '') return '';
  return stripped
    .split('/')
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeIdForUrl(seg))
    .join('/');
}

/**
 * PRD-602-R6 — build the canonical `act://` URI for a node id.
 *
 * `mountPrefix` is the multi-mount mount prefix (e.g. `'/marketing'`); pass
 * `null` for single-mount deployments.
 */
export function buildResourceUri(
  host: string,
  mountPrefix: string | null,
  id: string,
): string {
  const encodedId = encodeIdForUrl(id);
  if (mountPrefix === null || mountPrefix === '' || mountPrefix === '/') {
    return `act://${host}/${encodedId}`;
  }
  const prefixSegments = encodePrefixSegments(mountPrefix);
  if (prefixSegments === '') {
    return `act://${host}/${encodedId}`;
  }
  return `act://${host}/${prefixSegments}/${encodedId}`;
}

/**
 * PRD-602-R7 — manifest resource URI. The unprefixed
 * `act://<host>/manifest` resource carries the parent (routing) manifest
 * in multi-mount deployments and the runtime-profile manifest in
 * single-mount deployments.
 */
export function buildManifestUri(host: string, mountPrefix: string | null): string {
  return buildResourceUri(host, mountPrefix, MANIFEST_RESOURCE_ID);
}

/**
 * PRD-602-R11 — subtree-root list resource URI.
 *
 *   single-mount: `act://<host>/<id>?subtree=1`
 *   multi-mount:  `act://<host>/<prefix>/<id>?subtree=1`
 */
export function buildSubtreeUri(
  host: string,
  mountPrefix: string | null,
  id: string,
): string {
  return `${buildResourceUri(host, mountPrefix, id)}?subtree=1`;
}

/**
 * PRD-602 Security §"URI scheme injection" — reject `host` values that
 * contain reserved characters outside RFC 3986's `reg-name` grammar.
 *
 * `reg-name = *( unreserved / pct-encoded / sub-delims )`
 *  unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
 *  sub-delims = "!" / "$" / "&" / "'" / "(" / ")"
 *               / "*" / "+" / "," / ";" / "="
 *
 * Hosts MAY include port (`:1234`) per RFC 3986 `authority`. Path-segment
 * separators (`/`), fragment (`#`), query (`?`), userinfo (`@`), and
 * whitespace are all rejected. Empty hosts are rejected.
 */
const VALID_HOST_RE = /^[A-Za-z0-9\-._~!$&'()*+,;=]+(?::[0-9]+)?$/;
export function isValidMcpHost(host: string): boolean {
  return host.length > 0 && VALID_HOST_RE.test(host);
}

/**
 * Resolve which mount a URI points to, by longest-prefix match per
 * PRD-106-R20. Returns `null` when the URI's prefix segment(s) match no
 * mount (the dispatch layer maps that to MCP `RESOURCE_NOT_FOUND`).
 *
 * `pathAfterHost` is the URI's path with any leading `/` already
 * stripped — i.e. the substring after `act://<host>/`.
 */
export function resolveMountByPath(
  pathAfterHost: string,
  mountPrefixes: readonly string[],
): { matchedPrefix: string; remainder: string } | null {
  // Sort longer prefixes first to honor longest-prefix match.
  const sorted = [...mountPrefixes].sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    const segments = encodePrefixSegments(prefix);
    if (segments === '') {
      // Root mount; matches anything as a fallback.
      return { matchedPrefix: prefix, remainder: pathAfterHost };
    }
    const head = `${segments}/`;
    if (pathAfterHost.startsWith(head)) {
      return { matchedPrefix: prefix, remainder: pathAfterHost.slice(head.length) };
    }
    if (pathAfterHost === segments) {
      return { matchedPrefix: prefix, remainder: '' };
    }
  }
  return null;
}
