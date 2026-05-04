/**
 * PRD-500-R29 discovery hand-off `Link` header.
 *
 * Format per PRD-106-R23:
 *   `</.well-known/act.json>; rel="act"; type="application/act-manifest+json"; profile="runtime"`
 *
 * The well-known path is `basePath`-prefixed when the SDK is mounted under
 * a sub-path per PRD-500-R26. The Link header MUST be present on every
 * response from an ACT endpoint (200 / 304 / 401 / 404 / 429 / 5xx);
 * `fixtures/500/negative/discovery-link-header-missing-on-401.json` is the
 * negative case.
 *
 * `actLinkHeaderMiddleware()` is the optional public helper for hosts that
 * want to emit the header on non-ACT branches (PRD-500-R29 scopes the SDK
 * itself to ACT endpoints only, per Open Question 3 resolution).
 */
import type { ActRequest } from './types.js';

/**
 * Build the discovery Link header value for a given basePath/wellKnownPath
 * pair. The default well-known path is `/.well-known/act.json` per
 * PRD-100-R3; under a basePath the effective URL is `<basePath><wellKnownPath>`.
 */
export function buildDiscoveryLink(basePath: string, wellKnownPath: string): string {
  const url = `${basePath}${wellKnownPath}`;
  return `<${url}>; rel="act"; type="application/act-manifest+json"; profile="runtime"`;
}

/**
 * PRD-500-R29 — public middleware helper. Returns a function that builds a
 * `Headers` object containing only the discovery `Link`. Hosts compose this
 * into their non-ACT response branches per their framework's middleware
 * conventions (Express `(req, res, next)`, Next.js middleware, etc.).
 *
 * The signature is `(req: ActRequest) => Headers` per PRD-500's helper
 * pattern; the request is accepted for signature uniformity and to allow
 * future request-aware variants. The default helper does not vary the Link
 * value by request — it only depends on the configured basePath.
 */
export function actLinkHeaderMiddleware(
  opts: { basePath?: string; wellKnownPath?: string } = {},
): (req: ActRequest) => Headers {
  const basePath = opts.basePath ?? '';
  const wellKnownPath = opts.wellKnownPath ?? '/.well-known/act.json';
  const link = buildDiscoveryLink(basePath, wellKnownPath);
  return (_req: ActRequest) => {
    const headers = new Headers();
    headers.set('Link', link);
    return headers;
  };
}
