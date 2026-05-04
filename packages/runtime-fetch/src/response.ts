/**
 * PRD-505-R8 — translate PRD-500's `ActResponse` into a WHATWG `Response`.
 *
 * Body branches:
 *   - `null`     → 304 / HEAD; `new Response(null, ...)`.
 *   - `string`   → JSON envelope body; `new Response(body, ...)`.
 *   - `AsyncIterable<string>` → NDJSON streaming via the manual
 *     `new ReadableStream({ start... })` form. PRD-505-R8 specifies the
 *     manual form (NOT `ReadableStream.from(asyncIterable)`) because
 *     `ReadableStream.from` is not yet uniformly available across v0.1
 *     target runtimes (Node.js < 22, some Bun versions).
 *
 * The SDK delegates everything else (status codes, `WWW-Authenticate`
 * headers, `ETag`, `Cache-Control`, `Vary`, the discovery hand-off
 * `Link` header, error envelope construction, content negotiation) to
 * PRD-500's `dispatch`. The `actResponse.headers` instance carries them
 * all; the SDK simply passes the `Headers` object through to the WHATWG
 * `Response` constructor.
 */
import type { ActResponse } from '@act-spec/runtime-core';

/** PRD-505-R8 — convert `ActResponse` → WHATWG `Response`. */
export function toFetchResponse(actResponse: ActResponse): Response {
  if (actResponse.body === null) {
    return new Response(null, {
      status: actResponse.status,
      headers: actResponse.headers,
    });
  }
  if (typeof actResponse.body === 'string') {
    return new Response(actResponse.body, {
      status: actResponse.status,
      headers: actResponse.headers,
    });
  }
  // NDJSON streaming branch — manual `ReadableStream` per PRD-505-R8.
  // `ReadableStream.from(asyncIterable)` is intentionally NOT used.
  const iter = actResponse.body;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const line of iter) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(stream, {
    status: actResponse.status,
    headers: actResponse.headers,
  });
}
