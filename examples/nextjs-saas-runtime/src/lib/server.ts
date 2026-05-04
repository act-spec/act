/**
 * Minimal Node HTTP bridge.
 *
 * `defineActMount` returns App Router-shape handlers (`(req: Request,
 * { params }) => Response`). To run end-to-end without booting Next.js,
 * we accept incoming Node IncomingMessage requests, build a WHATWG
 * `Request`, route by URL pathname, and stream the `Response` back. This
 * matches PRD-501-R5/R10 (the SDK never sees framework-specific request
 * types), and keeps the example launchable via `pnpm start` without a
 * full Next runtime in the example's dependency tree.
 *
 * Supports a `dispatch(request)` entry point so the same routing layer
 * powers both the live HTTP server and the in-process probe / validator.
 */
import { Buffer } from 'node:buffer';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { actMount } from './act-mount';
import { linkHeader } from './link-header';

const ACT_NODE_PREFIX = '/act/n/';
const ACT_SUBTREE_PREFIX = '/act/sub/';
const WELL_KNOWN = '/.well-known/act.json';
const INDEX_PATH = '/act/index.json';

/** Route a WHATWG `Request` through the mount; returns a WHATWG `Response`. */
export async function dispatch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === WELL_KNOWN) {
    return actMount.manifest(request);
  }
  if (pathname === INDEX_PATH) {
    return actMount.index(request);
  }
  if (pathname.startsWith(ACT_NODE_PREFIX)) {
    const idEncoded = pathname.slice(ACT_NODE_PREFIX.length);
    const segs = idEncoded.split('/').map((s) => decodeURIComponent(s));
    return actMount.node(request, { params: { id: segs } });
  }
  if (pathname.startsWith(ACT_SUBTREE_PREFIX)) {
    if (!actMount.subtree) {
      return new Response('subtree not enabled', { status: 404 });
    }
    const idEncoded = pathname.slice(ACT_SUBTREE_PREFIX.length);
    const segs = idEncoded.split('/').map((s) => decodeURIComponent(s));
    return actMount.subtree(request, { params: { id: segs } });
  }
  // Non-ACT route: produce an empty 200, then run the middleware so the
  // discovery Link hand-off is exercised end-to-end. PRD-705-R13.
  const passthrough = new Response('OK', { status: 200 });
  return linkHeader(request, passthrough);
}

/** Adapt a Node IncomingMessage into a WHATWG Request. */
async function nodeToRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const vv of v) headers.append(k, vv);
    } else {
      headers.set(k, v);
    }
  }
  const method = (req.method ?? 'GET').toUpperCase();
  // GET/HEAD have no body; otherwise buffer (the example only serves GET).
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}

/** Stream a WHATWG Response back to a Node ServerResponse. */
async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  // Append every header (including duplicates such as multiple
  // `WWW-Authenticate` per PRD-705-R9).
  response.headers.forEach((value, key) => {
    // Headers.forEach yields one entry per key with comma-joined values
    // for repeated headers. The dispatch pipeline emits multi-value
    // WWW-Authenticate via append() so the comma-separation is the
    // expected wire format. Pass through as-is.
    res.setHeader(key, value);
  });
  if (response.body === null) {
    res.end();
    return;
  }
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

/** Boot the HTTP server. Returns a handle the caller can `.close()`. */
export function startServer(port: number): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const request = await nodeToRequest(req);
        const response = await dispatch(request);
        await writeResponse(res, response);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[server] unhandled', err);
        res.statusCode = 500;
        res.end('internal');
      }
    })();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, baseUrl: `http://127.0.0.1:${actualPort}` });
    });
  });
}
