/**
 * `act_load_site(url)` — fetches `<url>/.well-known/act.json` and
 * returns the parsed manifest + any inspector findings.
 *
 * Implementation note: we cannot reach the manifest without doing some
 * walk work, but `@act-spec/inspector` does not currently export a
 * standalone `discoverManifest`. We achieve a cheap manifest-only
 * fetch by calling `walk(url, { sample: 0 })`, which still resolves
 * the manifest (and any version-band probes) but skips the index
 * fetch — see `walk.ts`'s `slice` slicing behaviour.
 */
import { walk } from '@act-spec/inspector';

import type { ServerCache } from '../cache.js';
import type { LoadSiteResult } from '../types.js';

export interface LoadSiteDeps {
  fetch?: typeof globalThis.fetch;
  cache: ServerCache;
}

export async function actLoadSite(url: string, deps: LoadSiteDeps): Promise<LoadSiteResult> {
  const cached = deps.cache.getManifest(url);
  if (cached !== undefined) {
    return { url, manifest: cached, findings: [] };
  }
  const opts: Parameters<typeof walk>[1] = { sample: 0 };
  if (deps.fetch !== undefined) opts.fetch = deps.fetch;
  const result = await walk(url, opts);
  if (result.manifest !== null) {
    deps.cache.setManifest(url, result.manifest);
  }
  return {
    url: result.url,
    manifest: result.manifest,
    findings: result.findings,
  };
}
