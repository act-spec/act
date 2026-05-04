/**
 * Discovery walk and reporter assembly (PRD-600-R8, R9, R10, R11, R17, R18,
 * R32, R33).
 *
 * This module implements the runtime-walk leg of the validator. The static
 * counterpart ({@link walkStatic}) takes a directory tree and validates the
 * file set without any HTTP. The runtime counterpart ({@link validateSite})
 * takes an origin URL and a (possibly auth-injecting) fetcher.
 *
 * The walk is deliberately conservative: it issues only enough requests to
 * fill the reporter's `declared` / `achieved` fields per PRD-600-R17 / R18
 * and never authenticates on its own (PRD-600-R32). Operators inject creds
 * via a custom `fetch` adapter.
 */
import type { AchievedLevel, ConformanceReport, DeliveryProfile, Gap, Warning } from '@act-spec/core';
import { validateIndex, validateManifest, validateNode, validateSubtree, type ValidateOptions } from './envelopes.js';
import { buildReport, inferAchievedLevel, searchBodyDeferredWarning } from './reporter.js';
import { ETAG_LOOSE_RE } from './etag.js';

/**
 * Probe the capability band advertised by the manifest (PRD-107-R6 / R8 / R10
 * / PRD-600-R18). Returns the highest band whose URL-template advertisement is
 * complete on the manifest — independent of any per-envelope schema gaps.
 * `inferAchievedLevel` then caps the report at the lower of (gap-derived band,
 * advertised band).
 *
 * Bands:
 *  - Core: `index_url` + `node_url_template`.
 *  - Standard: + `subtree_url_template`.
 *  - Plus: + `index_ndjson_url` + `search_url_template`.
 *
 * Returns `null` when even Core advertisement is incomplete (the per-envelope
 * manifest validator already emits the structural gap; this probe is purely
 * about band determination).
 *
 * Per PRD-107-R19, an unmet declared band emits a synthesized gap; that
 * synthesis happens at the `validateSite`/`walkStatic` layer where we know
 * the declared band. Here we only return the achievable band by capability
 * advertisement.
 */
export function probeCapabilityBand(manifest: unknown): AchievedLevel | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const m = manifest as Record<string, unknown>;
  const hasCore =
    typeof m['index_url'] === 'string' && typeof m['node_url_template'] === 'string';
  if (!hasCore) return null;
  const hasStandard = typeof m['subtree_url_template'] === 'string';
  const hasStrict =
    hasStandard &&
    typeof m['index_ndjson_url'] === 'string' &&
    typeof m['search_url_template'] === 'string';
  if (hasStrict) return 'strict';
  if (hasStandard) return 'standard';
  return 'core';
}

export interface ValidateSiteOptions extends ValidateOptions {
  /** Custom fetch adapter (e.g. to inject Authorization). */
  fetch?: typeof globalThis.fetch;
  /** Total request cap; default 64. */
  maxRequests?: number;
  /** Per-origin rate limit (requests/sec); default 1 (advisory; no sleep is enforced here for unit tests). */
  rateLimit?: number;
  /** Sample N nodes from the index (`'all'` for full walk); default 16. */
  sample?: number | 'all';
  /** Probe 401 + WWW-Authenticate without authenticating (PRD-600-R32). */
  probeAuth?: boolean;
  /** Required minimum level; surfaced via CLI exit code mapping. */
  minLevel?: AchievedLevel;
  /** Required delivery profile. */
  expectProfile?: DeliveryProfile;
  /** Override RFC 3339 timestamp; used by deterministic tests. */
  passedAt?: string;
}

/**
 * Tiny request budget per PRD-600-R33. Counts requests; delegates to the
 * supplied fetcher. The wall-clock rate limit is advisory for v0.1 — the
 * hard cap is the request count, which CI and unit tests rely on.
 */
class RequestBudget {
  public requestsMade = 0;

  constructor(
    private readonly limit: number,
    private readonly fetcher: typeof globalThis.fetch,
  ) {}

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    if (this.requestsMade >= this.limit) {
      throw new BudgetExceededError(this.limit);
    }
    this.requestsMade += 1;
    return this.fetcher(url, init);
  }
}

class BudgetExceededError extends Error {
  constructor(public readonly limit: number) {
    super(`request budget exceeded (limit ${limit})`);
  }
}

/**
 * The full discovery walk + reporter assembly. Returns a {@link ConformanceReport}
 * shaped per PRD-107-R16 / PRD-600-R16.
 */
export async function validateSite(
  url: string,
  opts: ValidateSiteOptions = {},
): Promise<ConformanceReport> {
  const fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const budget = new RequestBudget(opts.maxRequests ?? 64, fetcher);

  const manifestUrl = resolveManifestUrl(url);

  const gaps: Gap[] = [];
  const warnings: Warning[] = [];

  let declared: ConformanceReport['declared'] = { level: null, delivery: null };
  let achieved: ConformanceReport['achieved'] = { level: null, delivery: null };

  let manifest: unknown;
  try {
    const res = await budget.fetch(manifestUrl);
    if (!res.ok) {
      gaps.push({
        level: 'core',
        requirement: 'PRD-107-R17',
        missing: `manifest unreachable (${manifestUrl} returned HTTP ${res.status}).`,
      });
      return buildReport({
        url: manifestUrl,
        declared,
        achieved,
        gaps,
        warnings,
        walkSummary: {
          requests_made: budget.requestsMade,
          nodes_sampled: 0,
          sample_strategy: 'first-n',
          elapsed_ms: 0,
        },
        passedAt: opts.passedAt ?? new Date().toISOString(),
      });
    }
    manifest = (await res.json());
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      warnings.push({
        level: 'core',
        code: 'request-budget-exceeded',
        message: `request budget (${err.limit}) exceeded before manifest fetch.`,
      });
    } else if (isCorsError(err)) {
      warnings.push({
        level: 'core',
        code: 'cors-blocked',
        message: `fetch to ${manifestUrl} failed (likely CORS). Use the CLI or paste the manifest into the SPA.`,
      });
    } else {
      warnings.push({
        level: 'core',
        code: 'network-timeout',
        message: `fetch to ${manifestUrl} failed: ${describeError(err)}`,
      });
    }
    gaps.push({
      level: 'core',
      requirement: 'PRD-107-R17',
      missing: `manifest unreachable: ${manifestUrl}.`,
    });
    return buildReport({
      url: manifestUrl,
      declared,
      achieved,
      gaps,
      warnings,
      walkSummary: {
        requests_made: budget.requestsMade,
        nodes_sampled: 0,
        sample_strategy: 'first-n',
        elapsed_ms: 0,
      },
      passedAt: opts.passedAt ?? new Date().toISOString(),
    });
  }

  // Validate manifest envelope.
  const manifestResult = validateManifest(manifest, opts);
  gaps.push(...manifestResult.gaps);
  warnings.push(...manifestResult.warnings);

  declared = readDeclared(manifest);

  // PRD-600-R24: mandatory search-body-deferred warning.
  warnings.push(...searchBodyDeferredWarning(manifest));

  // PRD-600-R11: walk index per discovery flow.
  const indexUrl = resolveIndexUrl(manifestUrl, manifest);
  let nodesSampled = 0;
  if (indexUrl !== null) {
    try {
      const idxRes = await budget.fetch(indexUrl);
      if (idxRes.ok) {
        const idxBody = (await idxRes.json());
        const idxResult = validateIndex(idxBody, opts);
        gaps.push(...idxResult.gaps);
        warnings.push(...idxResult.warnings);

        const sampleSize = opts.sample === 'all' ? Infinity : opts.sample ?? 16;
        const nodes = Array.isArray((idxBody as { nodes?: unknown[] }).nodes)
          ? ((idxBody as { nodes: unknown[] }).nodes)
          : [];
        const slice = nodes.slice(0, Math.min(sampleSize, nodes.length));
        const nodeUrlTemplate = (manifest as { node_url_template?: unknown }).node_url_template;
        for (const entry of slice) {
          if (
            !entry ||
            typeof entry !== 'object' ||
            typeof (entry as { id?: unknown }).id !== 'string' ||
            typeof nodeUrlTemplate !== 'string'
          ) {
            continue;
          }
          const id = (entry as { id: string }).id;
          const nodeUrl = substituteId(manifestUrl, nodeUrlTemplate, id);
          try {
            const nRes = await budget.fetch(nodeUrl);
            if (!nRes.ok) {
              gaps.push({
                level: 'core',
                requirement: 'PRD-100-R21',
                missing: `node ${id} unreachable (HTTP ${nRes.status}).`,
              });
              continue;
            }
            // PRD-600-R9: HTTP ETag header byte-equality.
            const headerEtag = nRes.headers.get('etag');
            const nodeBody = (await nRes.json());
            const nodeRes = validateNode(nodeBody, opts);
            gaps.push(...nodeRes.gaps);
            warnings.push(...nodeRes.warnings);
            const envelopeEtag = (nodeBody as { etag?: unknown }).etag;
            if (typeof headerEtag === 'string' && typeof envelopeEtag === 'string') {
              if (/^W\//.test(headerEtag)) {
                gaps.push({
                  level: 'core',
                  requirement: 'PRD-103-R10',
                  missing: `node ${id}: ETag header carries weak prefix W/.`,
                });
              } else {
                const stripped = headerEtag.replace(/^"|"$/g, '');
                if (stripped !== envelopeEtag) {
                  gaps.push({
                    level: 'core',
                    requirement: 'PRD-103-R5',
                    missing: `node ${id}: HTTP ETag header (${headerEtag}) ≠ envelope etag (${envelopeEtag}).`,
                  });
                }
              }
            }
            nodesSampled += 1;
          } catch (err) {
            if (err instanceof BudgetExceededError) {
              warnings.push({
                level: 'core',
                code: 'request-budget-exceeded',
                message: `request budget (${err.limit}) exceeded mid-walk; ${nodesSampled} of ${slice.length} sampled nodes fetched.`,
              });
              break;
            }
            warnings.push({
              level: 'core',
              code: 'network-timeout',
              message: `node ${id} fetch failed: ${describeError(err)}`,
            });
          }
        }
      } else {
        gaps.push({
          level: 'core',
          requirement: 'PRD-100-R16',
          missing: `index unreachable (${indexUrl} returned HTTP ${idxRes.status}).`,
        });
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        warnings.push({
          level: 'core',
          code: 'request-budget-exceeded',
          message: `request budget (${err.limit}) exceeded fetching index.`,
        });
      } else {
        warnings.push({
          level: 'core',
          code: 'network-timeout',
          message: `index fetch failed: ${describeError(err)}`,
        });
      }
    }
  }

  // PRD-600-R18 / PRD-107-R6 / R8 / R10: derive the highest achievable band
  // from the manifest's URL-template advertisement, then take the minimum of
  // (gap-derived band, advertised band).
  const advertised = probeCapabilityBand(manifest);
  const gapBand = inferAchievedLevel(gaps);
  const achievedLevel = capByAdvertised(gapBand, advertised);
  achieved = { level: achievedLevel, delivery: declared.delivery };

  // PRD-107-R19 synthesis.
  pushDeclaredButNotAchievedGaps(gaps, declared.level, achievedLevel);

  // PRD-600-R19 / PRD-107-R19 are self-consistent here because every band
  // demotion is caused by a band-level gap that `inferAchievedLevel`
  // already saw. No synthetic gap-injection is needed.

  return buildReport({
    url: manifestUrl,
    declared,
    achieved,
    gaps,
    warnings,
    walkSummary: {
      requests_made: budget.requestsMade,
      nodes_sampled: nodesSampled,
      sample_strategy: opts.sample === 'all' ? 'all' : 'first-n',
      elapsed_ms: 0,
    },
    passedAt: opts.passedAt ?? new Date().toISOString(),
  });
}

/**
 * Static walk: validate every envelope in a recorded fixture set against the
 * schemas, returning a `ConformanceReport`. This is the offline counterpart
 * to {@link validateSite} — no HTTP, no fetcher.
 *
 * Inputs: a manifest object, an index object, and an array of node objects.
 * Useful for fixtures under `fixtures/600/positive/discovery-walk-static-*.json`.
 */
export function walkStatic(input: {
  url: string;
  manifest: unknown;
  index?: unknown;
  nodes?: readonly unknown[];
  /** Optional subtree envelopes to validate (PRD-100-R32 / PRD-107-R8). */
  subtrees?: readonly unknown[];
  passedAt?: string;
}): ConformanceReport {
  const gaps: Gap[] = [];
  const warnings: Warning[] = [];

  const manifestRes = validateManifest(input.manifest);
  gaps.push(...manifestRes.gaps);
  warnings.push(...manifestRes.warnings);

  const declared = readDeclared(input.manifest);
  warnings.push(...searchBodyDeferredWarning(input.manifest));

  if (input.index !== undefined) {
    const idxRes = validateIndex(input.index);
    gaps.push(...idxRes.gaps);
    warnings.push(...idxRes.warnings);
  }
  if (input.nodes) {
    for (const n of input.nodes) {
      const nr = validateNode(n);
      gaps.push(...nr.gaps);
      warnings.push(...nr.warnings);
    }
  }
  if (input.subtrees) {
    for (const s of input.subtrees) {
      const sr = validateSubtree(s);
      gaps.push(...sr.gaps);
      warnings.push(...sr.warnings);
    }
  }

  // PRD-600-R18 / PRD-107-R6 / R8 / R10: derive the highest achievable band
  // from the manifest's URL-template advertisement, then take the minimum of
  // (gap-derived band, advertised band). A clean Core-only manifest reaches
  // 'core' (not 'strict') because Standard/Plus URL templates aren't advertised.
  const advertised = probeCapabilityBand(input.manifest);
  const gapBand = inferAchievedLevel(gaps);
  const achievedLevel = capByAdvertised(gapBand, advertised);
  const achieved = { level: achievedLevel, delivery: declared.delivery };

  // PRD-107-R19: emit a synthesized gap for every declared-but-not-achieved
  // level. Only fires when declared > achieved AND the existing gap set
  // doesn't already carry a gap at the unmet declared band.
  pushDeclaredButNotAchievedGaps(gaps, declared.level, achievedLevel);

  return buildReport({
    url: input.url,
    declared,
    achieved,
    gaps,
    warnings,
    walkSummary: {
      requests_made: 0,
      nodes_sampled: input.nodes?.length ?? 0,
      sample_strategy: 'all',
      elapsed_ms: 0,
    },
    passedAt: input.passedAt ?? new Date().toISOString(),
  });
}

/**
 * Two consecutive identical-credentials probes against a node URL; if the
 * payloads (envelope minus `etag`) are byte-identical and the etag values
 * differ, emit a gap citing PRD-103-R7. Used by the runtime determinism
 * prober per PRD-600-R8.
 */
export async function probeEtagDeterminism(
  url: string,
  fetcher: typeof globalThis.fetch,
): Promise<Gap[]> {
  const a = await fetcher(url);
  const aBody = (await a.json()) as { etag?: unknown };
  const b = await fetcher(url);
  const bBody = (await b.json()) as { etag?: unknown };
  const aEtag = aBody.etag;
  const bEtag = bBody.etag;
  // Strip etag and compare canonically.
  const stripped = (x: { etag?: unknown }): unknown => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      if (k !== 'etag') out[k] = v;
    }
    return out;
  };
  const aPayload = JSON.stringify(stripped(aBody));
  const bPayload = JSON.stringify(stripped(bBody));
  if (aPayload === bPayload && aEtag !== bEtag) {
    return [
      {
        level: 'core',
        requirement: 'PRD-103-R7',
        missing: `runtime etag varies between two consecutive identical requests; payload byte-identical, etag changed (${String(aEtag)} → ${String(bEtag)}).`,
      },
    ];
  }
  return [];
}

/**
 * Probe `If-None-Match` semantics (PRD-600-R10 / PRD-103-R8): a follow-up
 * request with `If-None-Match: "<etag-from-prior-200>"` MUST yield 304.
 */
export async function probeIfNoneMatch(
  url: string,
  fetcher: typeof globalThis.fetch,
): Promise<Gap[]> {
  const first = await fetcher(url);
  if (!first.ok) {
    return [];
  }
  const body = (await first.json()) as { etag?: unknown };
  const etag = body.etag;
  if (typeof etag !== 'string' || !ETAG_LOOSE_RE.test(etag)) {
    return [];
  }
  const second = await fetcher(url, {
    headers: { 'if-none-match': `"${etag}"` },
  });
  if (second.status !== 304) {
    return [
      {
        level: 'core',
        requirement: 'PRD-103-R8',
        missing: `If-None-Match revalidation: expected 304 with prior etag, got ${second.status}.`,
      },
    ];
  }
  return [];
}

/**
 * Probe the `--probe-auth` contract (PRD-600-R32 / PRD-106-R5 / R8 /
 * PRD-109-R5): an unauthenticated request to a runtime origin MUST yield
 * 401 with a correctly-shaped `WWW-Authenticate` challenge.
 *
 * The validator NEVER authenticates; the operator does that via the custom
 * fetch adapter (Example 5 in PRD-600).
 */
export async function probeAuthChallenge(
  url: string,
  fetcher: typeof globalThis.fetch,
): Promise<Gap[]> {
  const res = await fetcher(url);
  if (res.status !== 401) {
    return [
      {
        level: 'core',
        requirement: 'PRD-106-R5',
        missing: `auth probe: expected 401, got ${res.status}.`,
      },
    ];
  }
  const challenge = res.headers.get('www-authenticate');
  if (challenge === null || challenge.trim().length === 0) {
    return [
      {
        level: 'core',
        requirement: 'PRD-106-R8',
        missing: 'auth probe: 401 without WWW-Authenticate challenge.',
      },
    ];
  }
  return [];
}

function readDeclared(manifest: unknown): {
  level: AchievedLevel | null;
  delivery: DeliveryProfile | null;
} {
  if (!manifest || typeof manifest !== 'object') {
    return { level: null, delivery: null };
  }
  const m = manifest as { conformance?: unknown; delivery?: unknown };
  let level: AchievedLevel | null = null;
  if (m.conformance && typeof m.conformance === 'object') {
    const lv = (m.conformance as { level?: unknown }).level;
    if (lv === 'core' || lv === 'standard' || lv === 'strict') level = lv;
  }
  let delivery: DeliveryProfile | null = null;
  if (m.delivery === 'static' || m.delivery === 'runtime') delivery = m.delivery;
  return { level, delivery };
}

function resolveManifestUrl(url: string): string {
  if (url.endsWith('/.well-known/act.json')) return url;
  try {
    const u = new URL(url);
    if (u.pathname === '/.well-known/act.json') return u.toString();
    return new URL('/.well-known/act.json', u).toString();
  } catch {
    return url;
  }
}

function resolveIndexUrl(manifestUrl: string, manifest: unknown): string | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const indexUrl = (manifest as { index_url?: unknown }).index_url;
  if (typeof indexUrl !== 'string') return null;
  try {
    return new URL(indexUrl, manifestUrl).toString();
  } catch {
    return indexUrl;
  }
}

function substituteId(manifestUrl: string, template: string, id: string): string {
  const filled = template.replace('{id}', encodeURIComponent(id).replace(/%2F/g, '/'));
  try {
    return new URL(filled, manifestUrl).toString();
  } catch {
    return filled;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const BAND_RANK: Record<AchievedLevel, number> = { core: 0, standard: 1, strict: 2 };

/**
 * PRD-600-R18: take the minimum of (gap-derived band, advertised band).
 * If either is null (Core checks failed), the result is null.
 */
function capByAdvertised(
  gapBand: AchievedLevel | null,
  advertised: AchievedLevel | null,
): AchievedLevel | null {
  if (gapBand === null || advertised === null) return null;
  return BAND_RANK[gapBand] <= BAND_RANK[advertised] ? gapBand : advertised;
}

/**
 * PRD-107-R19: when declared > achieved, emit a synthesized gap citing the
 * unmet declared band. Skips emission if the existing gap set already carries
 * a gap at the unmet band (avoids double-citing). Mutates `gaps` in place.
 */
function pushDeclaredButNotAchievedGaps(
  gaps: Gap[],
  declared: AchievedLevel | null,
  achieved: AchievedLevel | null,
): void {
  if (declared === null || achieved === null) return;
  if (BAND_RANK[declared] <= BAND_RANK[achieved]) return;
  // Walk the unmet bands above achieved and at-or-below declared.
  const unmetBands: AchievedLevel[] = [];
  for (const band of ['standard', 'strict'] as const) {
    if (BAND_RANK[band] > BAND_RANK[achieved] && BAND_RANK[band] <= BAND_RANK[declared]) {
      unmetBands.push(band);
    }
  }
  for (const band of unmetBands) {
    if (gaps.some((g) => g.level === band)) continue;
    gaps.push({
      level: band,
      requirement: 'PRD-107-R19',
      missing: `declared ${declared} but capability advertisement reaches only ${achieved}; ${band}-band capability templates not advertised on manifest.`,
    });
  }
}

function isCorsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  return /cors/i.test(message);
}
