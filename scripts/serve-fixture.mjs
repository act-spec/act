#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Tiny CORS-enabled static server for example ACT sites.
// Usage: node scripts/serve-fixture.mjs <dir> <port>
//
// Why: each example writes its ACT files into a different directory
// (`dist/`, `_site/`, `public/`, `static/`). The validator and site-browser
// SPAs run on a different origin (vite dev server) so they need
// `Access-Control-Allow-Origin: *` to fetch — Astro preview, Next.js, and
// Docusaurus dev servers don't enable that by default.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('usage: serve-fixture.mjs <dir> <port>');
  process.exit(2);
}
const root = path.resolve(args[0]);
const port = Number(args[1]);

try {
  const s = await stat(root);
  if (!s.isDirectory()) throw new Error(`not a directory: ${root}`);
} catch (err) {
  console.error(`serve-fixture: ${err.message}`);
  process.exit(2);
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
};

async function resolveFile(reqUrl) {
  const url = new URL(reqUrl, 'http://x/');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const abs = path.join(root, rel);
  if (!abs.startsWith(root)) return null;
  try {
    const s = await stat(abs);
    if (s.isDirectory()) {
      const indexed = path.join(abs, 'index.html');
      try {
        await stat(indexed);
        return indexed;
      } catch { return null; }
    }
    return abs;
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, corsHeaders);
      res.end();
      return;
    }
    const file = await resolveFile(req.url ?? '/');
    if (!file) {
      res.writeHead(404, { ...corsHeaders, 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Not found: ${req.url}\n`);
      return;
    }
    let body;
    try { body = await readFile(file); } catch {
      res.writeHead(500, { ...corsHeaders, 'content-type': 'text/plain; charset=utf-8' });
      res.end('read error');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      ...corsHeaders,
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  })();
});

server.listen(port, '127.0.0.1', () => {
  const rel = path.relative(process.cwd(), root) || '.';
  console.log(`serve-fixture: http://127.0.0.1:${port}/  (cors=*, root=${rel})`);
  console.log(`  manifest: http://127.0.0.1:${port}/.well-known/act.json`);
});
