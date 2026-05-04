/**
 * PRD-706-R3 / R4 — hybrid HTTP server.
 *
 * Routes by URL prefix:
 *   /.well-known/act.json → static parent manifest from dist/
 *   /marketing/*          → static files served from dist/marketing/
 *   /app/.well-known/act.json
 *   /app/act/index.json
 *   /app/act/n/[...id]
 *   /app/act/sub/[...id]  → runtime mount via `defineActMount`.
 *
 * Other paths fall through to a 404. Real deployments substitute Vercel
 * routing, CloudFront behaviors, or the equivalent CDN config; this
 * example collapses both into one Node HTTP listener so the conformance
 * gate runs in-process.
 */
import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { actMount } from './act-mount.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..', '..');
const distRoot = path.resolve(exampleRoot, 'dist');
const marketingDist = path.resolve(distRoot, 'marketing');
const parentManifestPath = path.resolve(distRoot, '.well-known', 'act.json');

const APP_BASE = '/app';
const APP_WELL_KNOWN = '/app/.well-known/act.json';
const APP_INDEX = '/app/act/index.json';
const APP_NODE_PREFIX = '/app/act/n/';
const APP_SUBTREE_PREFIX = '/app/act/sub/';
const PARENT_WELL_KNOWN = '/.well-known/act.json';
const MARKETING_PREFIX = '/marketing/';

interface CapturedResponse {
  status: number;
  headers: Headers;
  body: string | Uint8Array | null;
}

async function serveStaticFile(absPath: string, contentType: string): Promise<CapturedResponse> {
  try {
    const buf = await fs.readFile(absPath);
    const headers = new Headers({
      'content-type': contentType,
      'content-length': String(buf.byteLength),
      // PRD-706-R9 — public marketing CDN posture for static files.
      'cache-control': 'public, max-age=300, must-revalidate',
      vary: 'Accept',
    });
    return { status: 200, headers, body: buf };
  } catch {
    const headers = new Headers({ 'content-type': 'application/json' });
    return {
      status: 404,
      headers,
      body: JSON.stringify({ error: 'not_found', path: absPath }),
    };
  }
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.ndjson')) return 'application/x-ndjson; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

/**
 * Route a WHATWG `Request` through the hybrid stack. Returns a captured
 * response shape used both by the live HTTP server and the in-process
 * conformance probes.
 */
export async function dispatch(request: Request): Promise<CapturedResponse> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Parent manifest (static) — PRD-706-R3.
  if (pathname === PARENT_WELL_KNOWN) {
    return serveStaticFile(parentManifestPath, 'application/json; charset=utf-8');
  }

  // Static marketing tree — PRD-706-R3.
  if (pathname.startsWith(MARKETING_PREFIX) || pathname === '/marketing/.well-known/act.json') {
    // Strip leading '/marketing/' and resolve against marketingDist.
    const sub = pathname.slice('/marketing/'.length);
    // Defend against path traversal — reject any '..' segment.
    if (sub.includes('..')) {
      return {
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ error: 'invalid_path' }),
      };
    }
    const abs = path.resolve(marketingDist, sub);
    if (!abs.startsWith(marketingDist)) {
      return {
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ error: 'invalid_path' }),
      };
    }
    return serveStaticFile(abs, contentTypeFor(abs));
  }

  // Runtime app mount — PRD-706-R6.
  if (pathname === APP_WELL_KNOWN) {
    const resp = await actMount.manifest(request);
    return captureResponse(resp);
  }
  if (pathname === APP_INDEX) {
    const resp = await actMount.index(request);
    return captureResponse(resp);
  }
  if (pathname.startsWith(APP_NODE_PREFIX)) {
    const idEncoded = pathname.slice(APP_NODE_PREFIX.length);
    const segs = idEncoded.split('/').map((s) => decodeURIComponent(s));
    const resp = await actMount.node(request, { params: { id: segs } });
    return captureResponse(resp);
  }
  if (pathname.startsWith(APP_SUBTREE_PREFIX)) {
    if (!actMount.subtree) {
      return {
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ error: 'subtree_not_enabled' }),
      };
    }
    const idEncoded = pathname.slice(APP_SUBTREE_PREFIX.length);
    const segs = idEncoded.split('/').map((s) => decodeURIComponent(s));
    const resp = await actMount.subtree(request, { params: { id: segs } });
    return captureResponse(resp);
  }
  if (pathname === APP_BASE || pathname === `${APP_BASE}/`) {
    return {
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
      body: 'Acme app — sign in to see your tenant.',
    };
  }

  return {
    status: 404,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ error: 'not_found' }),
  };
}

async function captureResponse(resp: Response): Promise<CapturedResponse> {
  const buf = resp.body === null ? null : Buffer.from(await resp.arrayBuffer());
  return { status: resp.status, headers: resp.headers, body: buf };
}

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
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}

async function writeResponse(res: ServerResponse, response: CapturedResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (response.body === null) {
    res.end();
    return;
  }
  if (typeof response.body === 'string') {
    res.end(response.body);
    return;
  }
  res.end(Buffer.from(response.body));
}

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
