/**
 * PRD-501-R5 — convert a Next.js (WHATWG) `Request` to PRD-500's `ActRequest`.
 *
 * The Next.js App Router exposes `request.cookies.get(name)?.value`. The
 * Pages Router escape hatch (PRD-501-R20) implements the same accessor
 * over a Node-style request via `req.cookies?.[name]`. Both branches
 * normalize to PRD-500-R2's `ActRequest` shape so the dispatch pipeline
 * never sees framework-specific request types.
 *
 * Notes:
 *   - We do NOT eagerly parse cookies from the `Cookie` header for the App
 *     Router branch; we use the framework-supplied cookie store. This
 *     avoids two parsers in the monorepo and matches Next's own
 *     conventions.
 *   - The `getCookie` accessor is invoked per-request by host
 *     `IdentityResolver` / `TenantResolver` implementations; PRD-501-R6
 *     documents the worked patterns (NextAuth, JWT, header-based service
 *     identity).
 *   - The Pages Router branch is structurally tied to `NextApiRequest`;
 *     we accept any object exposing `headers` (record) and an optional
 *     `cookies` record. The host re-export site is where the type lock
 *     happens.
 */
import type { ActRequest } from '@act-spec/runtime-core';
import type { PagesApiRequestLike } from './types.js';

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
 * PRD-501-R5 — normalize an App Router `Request`. The cookie accessor
 * tries the WHATWG `Request.cookies` shape (Next.js attaches a
 * `RequestCookies` instance); if absent, falls back to parsing the
 * `Cookie` header so the SDK works under plain WHATWG `Request` (e.g.,
 * in the in-process probe harness, or under the Edge Runtime where
 * Next.js still attaches `cookies`).
 */
export function fromAppRouter(request: Request): ActRequest {
  const url = new URL(request.url);
  const method = asMethod(request.method);
  const headers = request.headers;

  // Detect Next.js's `RequestCookies` accessor without importing `next`.
  // The shape is `{ get(name): { name, value } | undefined }`.
  const maybeCookies = (request as unknown as {
    cookies?: { get?: (name: string) => { value?: string } | undefined };
  }).cookies;
  const cookieHeader = headers.get('cookie') ?? '';

  function getCookie(name: string): string | undefined {
    if (maybeCookies && typeof maybeCookies.get === 'function') {
      const entry = maybeCookies.get(name);
      if (entry && typeof entry.value === 'string') return entry.value;
    }
    if (!cookieHeader) return undefined;
    // Cookie header parser — tolerant of leading whitespace; rejects
    // entries without `=`. We do NOT URL-decode the value (matches
    // Next.js's `RequestCookies` behavior, which also returns the raw
    // value).
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      if (trimmed.slice(0, eq) === name) {
        return trimmed.slice(eq + 1);
      }
    }
    return undefined;
  }

  return { method, url, headers, getCookie };
}

/**
 * PRD-501-R20 — normalize a Pages Router-style request. Builds a Headers
 * map from the framework's `headers` record and exposes cookies via the
 * Node-style `req.cookies` map (or the Cookie header as fallback).
 */
export function fromPagesRouter(req: PagesApiRequestLike, host: string): ActRequest {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(name, v);
    } else {
      headers.set(name, value);
    }
  }
  const url = new URL(req.url ?? '/', `http://${host}`);
  const method = asMethod(req.method);
  const cookieHeader = headers.get('cookie') ?? '';

  function getCookie(name: string): string | undefined {
    if (req.cookies && typeof req.cookies[name] === 'string') {
      return req.cookies[name];
    }
    if (!cookieHeader) return undefined;
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      if (trimmed.slice(0, eq) === name) {
        return trimmed.slice(eq + 1);
      }
    }
    return undefined;
  }

  return { method, url, headers, getCookie };
}
