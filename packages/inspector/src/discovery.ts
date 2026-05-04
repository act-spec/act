/**
 * Manifest discovery + version-band probing.
 *
 * `discoverManifest` performs PRD-101-R8 by way of a single fetch
 * against the well-known URL (the inspector does NOT chase `<link>` /
 * `Link:` rel="act" hand-offs in v0.1 — operators point us at the
 * manifest URL or its origin; the well-known path resolution is in
 * `http.ts`). The dedicated discovery walker sits here so that the
 * subcommand modules don't repeat it.
 *
 * `checkActVersion` enforces PRD-601-R3: an unknown MAJOR `act_version`
 * is rejected with a clear finding and CLI exit code 4.
 */
import { ACT_VERSION } from './version.js';
import { resolveManifestUrl, type RequestBudget, RequestBudgetExceededError, toFinding, type InvocationCache } from './http.js';
import { parseManifest } from './parsers.js';
import type { Finding } from './types.js';

export interface DiscoveryResult {
  manifestUrl: string;
  manifest: Record<string, unknown> | null;
  findings: Finding[];
}

/**
 * Resolve and fetch the manifest. Wraps every error path into a
 * `findings` entry; the caller decides exit code per PRD-601-R22.
 */
export async function discoverManifest(
  url: string,
  budget: RequestBudget,
  cache: InvocationCache,
  noCache: boolean,
  headers?: Record<string, string>,
): Promise<DiscoveryResult> {
  const manifestUrl = resolveManifestUrl(url);
  const findings: Finding[] = [];
  let res: Response;
  try {
    res = await budget.fetch(manifestUrl, withConditional(manifestUrl, cache, noCache, headers));
  } catch (err) {
    if (err instanceof RequestBudgetExceededError) {
      findings.push({
        code: 'request-budget-exceeded',
        message: `request budget (${err.limit}) exceeded before manifest fetch.`,
        severity: 'error',
      });
    } else {
      findings.push(toFinding('manifest-fetch-failed', err));
    }
    return { manifestUrl, manifest: null, findings };
  }
  if (res.status === 401) {
    const challenge = res.headers.get('www-authenticate') ?? '';
    findings.push({
      code: 'auth-required',
      message: `manifest at ${manifestUrl} returned 401${challenge ? ` (${challenge})` : ''}. Inject credentials via --header 'Authorization: ...' or the programmatic fetch adapter.`,
      severity: 'error',
    });
    return { manifestUrl, manifest: null, findings };
  }
  if (!res.ok) {
    findings.push({
      code: 'endpoint-404',
      message: `manifest unreachable: ${manifestUrl} returned HTTP ${res.status}.`,
      severity: 'error',
    });
    return { manifestUrl, manifest: null, findings };
  }
  cache.rememberFromResponse(manifestUrl, res);
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    findings.push(toFinding('manifest-parse-error', err));
    return { manifestUrl, manifest: null, findings };
  }
  const versionFindings = checkActVersion(body);
  findings.push(...versionFindings);
  if (versionFindings.some((f) => f.code === 'act-version-major-mismatch')) {
    return { manifestUrl, manifest: null, findings };
  }
  const parsed = parseManifest(body);
  findings.push(...parsed.findings);
  return { manifestUrl, manifest: parsed.value, findings };
}

function withConditional(
  url: string,
  cache: InvocationCache,
  noCache: boolean,
  headers?: Record<string, string>,
): RequestInit {
  const out = new Headers();
  if (headers) {
    for (const [k, v] of Object.entries(headers)) out.set(k, v);
  }
  if (!noCache) {
    const inm = cache.ifNoneMatchFor(url);
    if (inm !== undefined) out.set('if-none-match', `"${inm}"`);
  }
  return { headers: out };
}

/**
 * PRD-601-R3 / PRD-108-R8: a manifest declaring an `act_version` whose
 * MAJOR component is not the inspector's bundled MAJOR ("0" in v0.1)
 * MUST be rejected. Unknown MINORs are accepted with a `version-mismatch`
 * info finding (forward-compat per PRD-108-R7).
 */
export function checkActVersion(manifest: unknown): Finding[] {
  if (!manifest || typeof manifest !== 'object') return [];
  const av = (manifest as { act_version?: unknown }).act_version;
  if (typeof av !== 'string') return [];
  const major = av.split('.')[0];
  if (major === undefined) return [];
  const ourMajor = ACT_VERSION.split('.')[0]!;
  if (major !== ourMajor) {
    return [
      {
        code: 'act-version-major-mismatch',
        message: `manifest reports act_version="${av}" with MAJOR "${major}"; this inspector supports MAJOR "${ourMajor}" (act_version ${ACT_VERSION}).`,
        severity: 'error',
      },
    ];
  }
  if (av !== ACT_VERSION) {
    return [
      {
        code: 'version-mismatch',
        message: `manifest act_version="${av}" differs from bundled ${ACT_VERSION}; proceeding with best-effort parsing per PRD-108-R7.`,
        severity: 'warn',
      },
    ];
  }
  return [];
}
