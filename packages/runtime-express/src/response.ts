/**
 * PRD-502-R10 — translate PRD-500's `ActResponse` into Express's
 * `res.status().set().send()` chain.
 *
 * Body branches:
 *   - `string`   → `res.send(body)` after headers set.
 *   - `null`     → `res.end()` (304 / HEAD branch — no body).
 *   - `AsyncIterable<string>` → NDJSON streaming. We `flushHeaders()` so
 *     intermediaries see the headers immediately, then `res.write(line)`
 *     per line, then `res.end()`.
 *
 * The SDK MUST set `Content-Type` via `res.setHeader` BEFORE `res.send()`
 * to override Express's default `application/json; charset=utf-8`. We
 * iterate every header on the `ActResponse` and forward via `res.append`
 * (preserving multi-value semantics for `WWW-Authenticate` / `Link`).
 *
 * The SDK MUST NOT call `res.json()` (which would re-stringify and
 * re-set `Content-Type`); the body is already a serialized JSON string
 * from PRD-500's `dispatch`.
 *
 * The SDK MUST NOT call `next(err)` to forward errors — the response is
 * already constructed by the dispatch pipeline; see PRD-502-R14.
 */
import type { ActResponse } from '@act-spec/runtime-core';

import type { ExpressResponseLike } from './types.js';

/**
 * Apply headers from the `ActResponse` to an Express `res`. Uses
 * `append` so multi-value headers (`WWW-Authenticate`, `Link`) round-trip
 * correctly per PRD-502-R10 / PRD-502-R13.
 */
function applyHeaders(res: ExpressResponseLike, headers: Headers): void {
  // The Headers iteration order is insertion order; values are joined for
  // multi-value entries when accessed via `.get()`. We use `forEach` and
  // `append` to preserve every emitted value.
  // For `Set-Cookie` and other multi-value headers, Headers's `forEach`
  // collapses values per-name; we instead use `Headers.entries()` to
  // capture each emitted entry.
  // Note: WHATWG Headers actually concatenates duplicates with `, ` on
  // `forEach` callback, EXCEPT for `Set-Cookie` (`getSetCookie()`).
  // Our dispatch pipeline emits at most one of each header (the multi-
  // value `WWW-Authenticate` is comma-joined inside dispatch.ts already),
  // so a single `setHeader`-per-name is correct.
  headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
}

/**
 * Drain an `AsyncIterable<string>` into the response stream per
 * PRD-502-R10's NDJSON branch.
 */
async function streamNdjson(
  res: ExpressResponseLike,
  iter: AsyncIterable<string>,
): Promise<void> {
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
  for await (const line of iter) {
    res.write(line);
  }
  res.end();
}

/**
 * PRD-502-R10 — write an `ActResponse` to an Express `res`. Returns
 * a Promise so the caller can `await` (NDJSON streaming is async).
 */
export async function writeExpress(
  res: ExpressResponseLike,
  actResp: ActResponse,
): Promise<void> {
  // Defensive: if the response was already sent (e.g., upstream
  // middleware terminated), do nothing rather than emit a duplicate.
  if (res.headersSent === true) return;

  res.status(actResp.status);
  applyHeaders(res, actResp.headers);

  if (actResp.body === null) {
    res.end();
    return;
  }
  if (typeof actResp.body === 'string') {
    // `res.send(string)` writes the string verbatim; Express will not
    // override the `Content-Type` we already set via `setHeader`.
    res.send(actResp.body);
    return;
  }
  await streamNdjson(res, actResp.body);
}
