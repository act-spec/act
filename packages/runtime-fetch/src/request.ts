/**
 * PRD-505-R6 — convert a WHATWG `Request` to PRD-500's `ActRequest`.
 *
 * Because the input is *already* a WHATWG `Request`, normalization is a
 * thin shim per PRD-505-R6:
 *   - `method` ← `request.method`.
 *   - `url`    ← `new URL(request.url)`.
 *   - `headers`← `request.headers` (passed through; already a `Headers`
 *      instance per the WHATWG Fetch spec).
 *   - `getCookie(name)` ← parses `request.headers.get('cookie')` directly
 *      using the SDK's minimal cookie parser. We do NOT depend on a
 *      framework-supplied `request.cookies` accessor — many WHATWG-fetch
 *      runtimes (Cloudflare Workers, Bun, Deno's stock `Request`) do not
 *      expose one.
 *
 * The SDK MUST NOT mutate the input `Request` (PRD-505-R6).
 */
import type { ActRequest } from '@act-spec/runtime-core';

const ALLOWED_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
]);

/** Narrow `string` to `ActRequest['method']` after admit-list check. */
function asMethod(raw: string | undefined): ActRequest['method'] {
  const upper = (raw ?? 'GET').toUpperCase();
  if (ALLOWED_METHODS.has(upper)) {
    return upper as ActRequest['method'];
  }
  return 'GET';
}

/**
 * PRD-505-R6 — minimal cookie parser per the same shape used by
 * `@act-spec/runtime-next` / `@act-spec/runtime-express`. Tolerates
 * leading whitespace, rejects entries without `=`. Does NOT URL-decode
 * the value (cookie values are opaque to the SDK; hosts decoding signed
 * cookies do so inside their `IdentityResolver`).
 */
export function parseCookieHeader(
  header: string | null,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) {
      return trimmed.slice(eq + 1);
    }
  }
  return undefined;
}

/**
 * PRD-505-R6 — normalize a WHATWG `Request` to `ActRequest`. The SDK
 * MUST NOT mutate the input.
 */
export function fromFetchRequest(request: Request): ActRequest {
  const url = new URL(request.url);
  const method = asMethod(request.method);
  const headers = request.headers;
  const cookieHeader = headers.get('cookie');
  return {
    method,
    url,
    headers,
    getCookie: (name: string) => parseCookieHeader(cookieHeader, name),
  };
}
