/**
 * PRD-501-R20 — Pages Router escape-hatch handler.
 *
 * The Pages Router lacks per-file catch-all dynamic segments at our
 * preferred mount points; the documented pattern is a single catch-all
 * file `pages/api/act/[...act].ts` that dispatches internally based on
 * the request path. This module exposes `createActPagesHandler(options)`
 * returning that single handler.
 *
 * The dispatch path is identical to the App Router branch — the request
 * is normalized via `fromPagesRouter`, then sent through
 * `runtimeInstance.dispatch`, then encoded back to the Pages Router
 * response shape. No envelope, header, or body mutation along the way
 * (PRD-501-R10).
 *
 * NDJSON bodies are flushed eagerly into a single string before
 * `res.end()` since the Pages Router's `res.end()` does not support
 * streaming bodies in the legacy `NextApiResponse` shape; this is a
 * documented limitation of the escape hatch — Plus deployments SHOULD
 * use the App Router (PRD-501-R3).
 */
import { createActRuntime, type ActResponse } from '@act-spec/runtime-core';

import { fromPagesRouter } from './request.js';
import type {
  DefineActMountOptions,
  NextActPagesHandler,
  PagesApiRequestLike,
  PagesApiResponseLike,
} from './types.js';

async function readBody(actResp: ActResponse): Promise<string> {
  if (actResp.body === null) return '';
  if (typeof actResp.body === 'string') return actResp.body;
  const parts: string[] = [];
  for await (const part of actResp.body) parts.push(part);
  return parts.join('');
}

function writeResponse(res: PagesApiResponseLike, actResp: ActResponse, body: string): void {
  res.status(actResp.status);
  // Headers MUST be set BEFORE end(). Forward the multi-value
  // WWW-Authenticate semantics by collecting per-name values.
  const buckets = new Map<string, string[]>();
  actResp.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    const arr = buckets.get(lower) ?? [];
    arr.push(value);
    buckets.set(lower, arr);
  });
  for (const [name, values] of buckets) {
    const single = values[0];
    if (values.length === 1 && single !== undefined) {
      res.setHeader(name, single);
    } else {
      res.setHeader(name, values);
    }
  }
  res.end(body);
}

export function createActPagesHandler(options: DefineActMountOptions): NextActPagesHandler {
  // Construct ONE runtime instance per `createActPagesHandler` call.
  const basePath = options.basePath ?? '';
  const config = {
    manifest: options.manifest,
    runtime: options.runtime,
    identityResolver: options.identityResolver,
    ...(options.tenantResolver ? { tenantResolver: options.tenantResolver } : {}),
    ...(options.etagComputer ? { etagComputer: options.etagComputer } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    basePath,
    ...(options.anonymousCacheSeconds !== undefined
      ? { anonymousCacheSeconds: options.anonymousCacheSeconds }
      : {}),
    ...(options.wellKnownPath ? { wellKnownPath: options.wellKnownPath } : {}),
  };
  const instance = createActRuntime(config);
  return async (req: PagesApiRequestLike, res: PagesApiResponseLike): Promise<void> => {
    const hostHeader = req.headers['host'];
    const host = typeof hostHeader === 'string' ? hostHeader : 'localhost';
    const actReq = fromPagesRouter(req, host);
    const actResp = await instance.dispatch(actReq);
    const body = await readBody(actResp);
    writeResponse(res, actResp, body);
  };
}
