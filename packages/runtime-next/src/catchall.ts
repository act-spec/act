/**
 * PRD-501-R4 — catch-all `[...id]` segment joining.
 *
 * Next.js parses an App Router file path like `app/act/n/[...id]/route.ts`
 * with the URL `/act/n/doc/proj-launch-2026` to a `params.id` value of
 * `['doc', 'proj-launch-2026']`. PRD-100-R10 IDs may contain `/`; the SDK
 * MUST recover the canonical ID by joining with `/`.
 *
 * The dispatch pipeline (`@act-spec/runtime-core/dispatch`) re-derives the
 * ID from the URL pathname using the manifest's `node_url_template`. So
 * the leaf SDK's job is to ensure the URL pathname it hands to the
 * dispatch pipeline reflects the catch-all-joined ID. Two strategies
 * exist:
 *
 *   1. Read `params.id` from the App Router context, join with `/`, build
 *      a synthetic URL whose pathname is `<basePath>/<node-template-with-id>`,
 *      and dispatch with that URL. This is the option we adopt: the
 *      dispatch pipeline already handles template matching correctly, and
 *      the synthetic URL eliminates ambiguity around how Next.js
 *      represents the catch-all in `request.url` (which CAN encode the
 *      raw segment array as a query-style path on some Next versions).
 *
 *   2. Trust `request.url`'s pathname directly. This is brittle because
 *      Next.js Edge Runtime variants and middleware rewrites can mutate
 *      the URL between the matcher and the handler.
 *
 * We use strategy (1) for `node` and `subtree`; for `manifest`, `index`,
 * `indexNdjson`, `search` we use the request URL verbatim (no catch-all
 * involved). PRD-501-R4 is satisfied by construction.
 *
 * Percent-encoding: Next.js percent-decodes catch-all segments before
 * exposing them in `params`. PRD-106-R15 mandates the SDK accept both
 * percent-encoded and decoded forms consistently. We re-encode each
 * segment per PRD-500-R13's encoder before joining (the dispatch
 * pipeline will percent-decode again — round-tripping is safe and ensures
 * IDs whose decoded forms collide with template metacharacters do not
 * confuse the matcher).
 */
import { encodeIdForUrl } from '@act-spec/runtime-core';

/**
 * Read the catch-all `id` parameter and join into a canonical ID. The
 * Next.js context's `params` MAY be a plain object OR a Promise (Next 15
 * shifted to async params). We accept both.
 */
export async function readCatchAllId(
  ctx: { params?: Record<string, string | string[]> | Promise<Record<string, string | string[]>> } | undefined,
): Promise<string | null> {
  if (!ctx || !ctx.params) return null;
  const params = ctx.params instanceof Promise ? await ctx.params : ctx.params;
  const raw = params['id'];
  if (raw === undefined) return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    return raw.join('/');
  }
  return raw;
}

/**
 * Build the canonical URL for a node/subtree request. The dispatch
 * pipeline matches the manifest's `node_url_template` / `subtree_url_template`
 * against this URL's pathname; we substitute `{id}` with the
 * percent-encoded canonical ID (per-segment encoding via PRD-500-R13).
 */
export function buildEndpointUrl(args: {
  origin: string;
  basePath: string;
  template: string;
  canonicalId: string;
  search?: string;
}): URL {
  const { origin, basePath, template, canonicalId, search } = args;
  const encoded = encodeIdForUrl(canonicalId);
  const path = `${basePath}${template.replace('{id}', encoded)}`;
  const url = new URL(path, origin);
  if (search) url.search = search;
  return url;
}
