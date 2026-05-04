/**
 * PRD-502-R5 — convert an Express `Request` to PRD-500's `ActRequest`.
 *
 * Mapping rules:
 *  - `method` ← `req.method` (uppercased; non-allow-list values fall back to GET).
 *  - `url` ← `new URL(req.originalUrl, ${req.protocol}://${host})`. We use
 *    `originalUrl` (NOT `req.url`) because Express strips the mount
 *    prefix from `req.url` during `app.use(prefix, router)`. The
 *    `basePath` we pass to `createActRuntime` matches that prefix; the
 *    dispatch pipeline strips it again before endpoint matching. Using
 *    `originalUrl` ensures the URL the SDK serializes back into the
 *    manifest reflects the mount prefix.
 *  - `headers` ← a new `Headers` instance constructed from `req.headers`.
 *    Array-valued headers are flattened into multiple appends.
 *  - `getCookie(name)` ← reads `req.cookies?.[name]` first (when
 *    `cookie-parser` is registered upstream), then falls back to parsing
 *    `req.headers.cookie` directly. The SDK ships its own minimal cookie
 *    parser to avoid a dependency on `cookie-parser` (PRD-502-R5).
 */
import type { ActRequest } from '@act-spec/runtime-core';
import type { ExpressRequestLike } from './types.js';

const ALLOWED_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
]);

function asMethod(raw: string | undefined): ActRequest['method'] {
  const upper = (raw ?? 'GET').toUpperCase();
  if (ALLOWED_METHODS.has(upper)) {
    return upper as ActRequest['method'];
  }
  return 'GET';
}

/**
 * PRD-502-R5 — derive the host string. Prefers `req.get('host')` when
 * the accessor is present (real Express); falls back to the raw `host`
 * header. Defaults to `localhost` so the URL is always parseable
 * (PRD-500-R2's `URL` requires an absolute origin).
 */
function deriveHost(req: ExpressRequestLike): string {
  const fromGet = typeof req.get === 'function' ? req.get('host') : undefined;
  if (typeof fromGet === 'string' && fromGet.length > 0) return fromGet;
  const raw = req.headers['host'];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].length > 0) {
    return raw[0];
  }
  return 'localhost';
}

/**
 * Build a `Headers` instance from Express's `req.headers` record.
 * Array values are appended one entry at a time so multi-value headers
 * round-trip correctly.
 */
function buildHeaders(headers: ExpressRequestLike['headers']): Headers {
  const h = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) h.append(name, v);
    } else {
      h.set(name, value);
    }
  }
  return h;
}

/**
 * Minimal cookie parser per PRD-502-R5. Tolerates leading whitespace
 * and entries without `=`. Does NOT URL-decode values (matches
 * `cookie-parser`'s default raw-value behavior — hosts that signed-cookie
 * decode do so inside their `IdentityResolver`, see PRD-502 OQ4).
 */
function parseCookieHeader(header: string, name: string): string | undefined {
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
 * PRD-502-R5 — normalize an Express `Request`. The SDK MUST NOT mutate
 * the request during normalization.
 */
export function fromExpress(req: ExpressRequestLike): ActRequest {
  const host = deriveHost(req);
  const protocol = (req.protocol && req.protocol.length > 0 ? req.protocol : 'http').replace(
    /:?$/,
    '',
  );
  const path = req.originalUrl ?? req.url ?? '/';
  const url = new URL(path, `${protocol}://${host}`);
  const method = asMethod(req.method);
  const headers = buildHeaders(req.headers);

  const cookieHeaderRaw = req.headers['cookie'];
  const cookieHeader = Array.isArray(cookieHeaderRaw)
    ? cookieHeaderRaw.join('; ')
    : (cookieHeaderRaw ?? '');

  function getCookie(name: string): string | undefined {
    if (req.cookies && typeof req.cookies[name] === 'string') {
      return req.cookies[name];
    }
    return parseCookieHeader(cookieHeader, name);
  }

  return { method, url, headers, getCookie };
}
