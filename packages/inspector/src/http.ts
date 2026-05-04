/**
 * HTTP plumbing shared across inspector subcommands:
 *
 *  - {@link RequestBudget}: counts requests, enforces the
 *    `--max-requests` cap (PRD-601-R20), throws
 *    {@link RequestBudgetExceededError} when exhausted.
 *  - {@link toFinding}: lift a thrown error into a {@link Finding}.
 *  - {@link resolveManifestUrl}: PRD-101-R1 well-known resolution.
 *  - {@link resolveUrlAgainst}: relative→absolute URL composition.
 *  - {@link substituteId}: `{id}` template expansion per PRD-100-R26.
 *  - {@link InvocationCache}: in-invocation ETag store backing
 *    `If-None-Match` emission (PRD-601-R9). NOT persisted.
 */
import type { Finding } from './types.js';

export class RequestBudgetExceededError extends Error {
  constructor(public readonly limit: number) {
    super(`request budget exceeded (limit ${limit})`);
  }
}

/**
 * Counts requests made through a fetcher and throws when the cap is
 * reached. The `requestsMade` counter is exposed for the CLI's
 * `walk_summary` field.
 */
export class RequestBudget {
  public requestsMade = 0;
  public elapsedMs = 0;
  private readonly start = Date.now();

  constructor(
    private readonly limit: number,
    private readonly fetcher: typeof globalThis.fetch,
  ) {}

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    if (this.requestsMade >= this.limit) {
      throw new RequestBudgetExceededError(this.limit);
    }
    this.requestsMade += 1;
    const res = await this.fetcher(url, init);
    this.elapsedMs = Date.now() - this.start;
    return res;
  }

  summary(): { requests_made: number; elapsed_ms: number } {
    return { requests_made: this.requestsMade, elapsed_ms: this.elapsedMs };
  }
}

/**
 * Resolve a producer URL to its `.well-known/act.json` manifest URL
 * per PRD-101-R1. If `url` is already a manifest URL it is returned
 * verbatim. Non-URL strings (e.g. a `file://` path treated literally)
 * pass through unchanged.
 */
export function resolveManifestUrl(url: string): string {
  if (url.endsWith('/.well-known/act.json')) return url;
  try {
    const u = new URL(url);
    if (u.pathname === '/.well-known/act.json') return u.toString();
    return new URL('/.well-known/act.json', u).toString();
  } catch {
    return url;
  }
}

/** Compose a (possibly relative) URL against the manifest URL. */
export function resolveUrlAgainst(base: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

/**
 * `{id}` template expansion per PRD-100-R26. Slash characters in the
 * id are preserved (matches the validator's `substituteId` to avoid
 * drift; PRD-601-R1 reuse spirit).
 */
export function substituteId(template: string, id: string): string {
  return template.replace('{id}', encodeURIComponent(id).replace(/%2F/g, '/'));
}

/**
 * In-invocation cache of (url → ETag) recorded from prior 200
 * responses. Backs the inspector's `If-None-Match` emission per
 * PRD-601-R9. Per spec there is no persistence across invocations.
 */
export class InvocationCache {
  private readonly etags = new Map<string, string>();

  rememberFromResponse(url: string, res: Response): void {
    if (!res.ok) return;
    const etag = res.headers.get('etag');
    if (typeof etag === 'string' && etag.length > 0) {
      this.etags.set(url, etag);
    }
  }

  ifNoneMatchFor(url: string): string | undefined {
    return this.etags.get(url);
  }

  clear(): void {
    this.etags.clear();
  }
}

/** Lift a thrown error into a structured finding. */
export function toFinding(code: string, err: unknown, severity: Finding['severity'] = 'error'): Finding {
  const message = err instanceof Error ? err.message : String(err);
  return { code, message, severity };
}

/**
 * Same-registrable-domain check for cross-origin mount detection
 * (PRD-601-R8). v0.1 uses a simple "same hostname OR shared
 * top-two-labels" heuristic — full PSL-aware classification is
 * deferred. The conservative posture: when in doubt, treat as
 * cross-origin (operator opts out via `--no-follow-cross-origin`).
 */
export function isSameRegistrableDomain(a: string, b: string): boolean {
  let ha: string;
  let hb: string;
  try {
    ha = new URL(a).hostname.toLowerCase();
    hb = new URL(b).hostname.toLowerCase();
  } catch {
    return a === b;
  }
  if (ha === hb) return true;
  const partsA = ha.split('.').filter(Boolean);
  const partsB = hb.split('.').filter(Boolean);
  if (partsA.length < 2 || partsB.length < 2) return false;
  const tailA = partsA.slice(-2).join('.');
  const tailB = partsB.slice(-2).join('.');
  return tailA === tailB;
}
