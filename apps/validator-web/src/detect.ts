// SPDX-License-Identifier: Apache-2.0
/**
 * Heuristics for the SPA's paste-mode UX.
 *
 * The library exposes per-envelope validators (`validateManifest`,
 * `validateNode`, `validateIndex`, `validateSubtree`, `validateError`,
 * `validateNdjsonIndex`); the SPA needs to pick the right one when the user
 * pastes JSON without explicitly choosing the kind. These detectors are
 * intentionally cheap and side-effect-free so we can unit-test them
 * exhaustively without spinning a DOM.
 */

export type EnvelopeKind = 'manifest' | 'node' | 'index' | 'subtree' | 'error' | 'ndjson';

/**
 * Decide whether a string looks like a URL the SPA should fetch (rather than
 * try to parse as JSON). Accepts http/https only — anything else (file://,
 * data:, raw `paste`) is treated as paste content.
 */
export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Heuristic NDJSON detector: more than one non-empty line and every non-empty
 * line is JSON-parseable. We intentionally allow trailing whitespace and
 * blank lines because Plus-tier indexes streamed from a CDN often carry them.
 */
export function looksLikeNdjson(input: string): boolean {
  const lines = input.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return false;
  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch {
      return false;
    }
  }
  return true;
}

interface DetectedShape {
  kind: EnvelopeKind;
  parsed?: unknown;
}

/**
 * Detect the envelope kind for a JSON paste. Order of precedence:
 *
 *  1. NDJSON (multi-line JSON) → `ndjson`.
 *  2. Top-level fields:
 *     - `node_url_template` or `index_url` → `manifest`.
 *     - `error` (and only `act_version` + `error`) → `error`.
 *     - `nodes` and `depth` → `subtree`.
 *     - `nodes` (no `depth`) → `index`.
 *     - `etag` + `id` (typical node) → `node`.
 *  3. Fallback → `node` (the most permissive at the schema layer).
 */
export function detectEnvelopeKind(input: string): DetectedShape {
  if (looksLikeNdjson(input)) return { kind: 'ndjson' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    // Caller will surface the JSON parse error via the envelope validator.
    return { kind: 'node' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { kind: 'node', parsed };
  }
  const obj = parsed as Record<string, unknown>;

  // Manifest: discovery-template fields are unique to PRD-100 manifest.
  if (typeof obj['node_url_template'] === 'string' || typeof obj['index_url'] === 'string') {
    return { kind: 'manifest', parsed };
  }

  // Error: PRD-100-R41 closes the error envelope to {act_version, error}.
  if ('error' in obj && typeof obj['error'] === 'object' && obj['error'] !== null) {
    return { kind: 'error', parsed };
  }

  // Subtree: PRD-100-R32 always carries `depth` + `nodes` + `root`.
  if ('nodes' in obj && 'depth' in obj && 'root' in obj) {
    return { kind: 'subtree', parsed };
  }

  // Index: per PRD-100-R17 the index envelope carries a top-level `nodes`
  // array (and lacks `depth`/`root`).
  if (Array.isArray(obj['nodes'])) {
    return { kind: 'index', parsed };
  }

  // Node: every node carries `id` + `etag` (PRD-100-R21 / PRD-103-R1). We
  // also fall through here for any remaining shape — node is the most
  // permissive validator and yields the most useful gap citations on
  // mis-detected paste.
  return { kind: 'node', parsed };
}
