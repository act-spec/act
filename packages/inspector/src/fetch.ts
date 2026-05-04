/**
 * Single-envelope fetchers — `node` (PRD-100-R21) and `subtree`
 * (PRD-100-R32 / PRD-601-R11).
 *
 * Each delegates the manifest discovery to {@link discoverManifest}
 * so the well-known walk + version probe happen exactly once. Each
 * surfaces the producer-level requirement (subtree → Standard) as a
 * structured finding so the CLI can map it to exit code 3 per
 * PRD-601-R22.
 */
import { RequestBudget, InvocationCache, resolveUrlAgainst, substituteId, toFinding } from './http.js';
import { discoverManifest } from './discovery.js';
import { parseNode, parseSubtree } from './parsers.js';
import type { Finding, NodeOptions, NodeResult, SubtreeOptions, SubtreeResult } from './types.js';

const SUBTREE_DEPTH_DEFAULT = 3;
const SUBTREE_DEPTH_MIN = 0;
const SUBTREE_DEPTH_MAX = 8;

export async function node(url: string, id: string, opts: NodeOptions = {}): Promise<NodeResult> {
  const fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const budget = new RequestBudget(opts.maxRequests ?? 32, fetcher);
  const cache = new InvocationCache();
  const findings: Finding[] = [];

  const disc = await discoverManifest(url, budget, cache, opts.noCache ?? false, opts.headers);
  findings.push(...disc.findings);
  if (disc.manifest === null) {
    return { url: disc.manifestUrl, node: null, findings };
  }
  const tpl = disc.manifest['node_url_template'];
  if (typeof tpl !== 'string') {
    findings.push({
      code: 'endpoint-404',
      message: 'manifest does not advertise node_url_template.',
      severity: 'error',
    });
    return { url: disc.manifestUrl, node: null, findings };
  }
  const nodeUrl = resolveUrlAgainst(disc.manifestUrl, substituteId(tpl, id));
  const headers = new Headers();
  if (opts.headers) for (const [k, v] of Object.entries(opts.headers)) headers.set(k, v);
  let res: Response;
  try {
    res = await budget.fetch(nodeUrl, { headers });
  } catch (err) {
    findings.push(toFinding('node-fetch-failed', err));
    return { url: nodeUrl, node: null, findings };
  }
  if (!res.ok) {
    findings.push({
      code: 'endpoint-404',
      message: `node ${id} unreachable: HTTP ${res.status} from ${nodeUrl}.`,
      severity: 'error',
    });
    return { url: nodeUrl, node: null, findings };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    findings.push(toFinding('node-parse-error', err));
    return { url: nodeUrl, node: null, findings };
  }
  const parsed = parseNode(body);
  findings.push(...parsed.findings);
  return { url: nodeUrl, node: parsed.value ?? body, findings };
}

export async function subtree(url: string, id: string, opts: SubtreeOptions = {}): Promise<SubtreeResult> {
  const fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const budget = new RequestBudget(opts.maxRequests ?? 32, fetcher);
  const cache = new InvocationCache();
  const findings: Finding[] = [];
  const reqDepth = opts.depth ?? SUBTREE_DEPTH_DEFAULT;
  if (reqDepth < SUBTREE_DEPTH_MIN || reqDepth > SUBTREE_DEPTH_MAX) {
    findings.push({
      code: 'subtree-depth-out-of-range',
      message: `subtree depth ${reqDepth} out of range [${SUBTREE_DEPTH_MIN}, ${SUBTREE_DEPTH_MAX}] (PRD-601-R11).`,
      severity: 'error',
    });
    return { url, subtree: null, findings };
  }

  const disc = await discoverManifest(url, budget, cache, opts.noCache ?? false, opts.headers);
  findings.push(...disc.findings);
  if (disc.manifest === null) {
    return { url: disc.manifestUrl, subtree: null, findings };
  }
  const declared = readLevel(disc.manifest);
  if (declared === 'core') {
    findings.push({
      code: 'subtree-requires-standard',
      message: 'manifest declares conformance.level=core; subtree probes require Standard (PRD-601-R11).',
      severity: 'error',
    });
    return { url: disc.manifestUrl, subtree: null, findings };
  }
  const tpl = disc.manifest['subtree_url_template'];
  if (typeof tpl !== 'string') {
    findings.push({
      code: 'subtree-requires-standard',
      message: 'manifest does not advertise subtree_url_template (PRD-601-R11).',
      severity: 'error',
    });
    return { url: disc.manifestUrl, subtree: null, findings };
  }
  const subUrl = resolveUrlAgainst(disc.manifestUrl, substituteId(tpl, id));
  const headers = new Headers();
  if (opts.headers) for (const [k, v] of Object.entries(opts.headers)) headers.set(k, v);
  let res: Response;
  try {
    res = await budget.fetch(subUrl, { headers });
  } catch (err) {
    findings.push(toFinding('subtree-fetch-failed', err));
    return { url: subUrl, subtree: null, findings };
  }
  if (!res.ok) {
    findings.push({
      code: 'endpoint-404',
      message: `subtree ${id} unreachable: HTTP ${res.status} from ${subUrl}.`,
      severity: 'error',
    });
    return { url: subUrl, subtree: null, findings };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    findings.push(toFinding('subtree-parse-error', err));
    return { url: subUrl, subtree: null, findings };
  }
  const parsed = parseSubtree(body);
  findings.push(...parsed.findings);
  return { url: subUrl, subtree: parsed.value ?? body, findings };
}

function readLevel(m: Record<string, unknown>): 'core' | 'standard' | 'strict' | null {
  const c = m['conformance'];
  if (!c || typeof c !== 'object') return null;
  const lv = (c as { level?: unknown }).level;
  return lv === 'core' || lv === 'standard' || lv === 'strict' ? lv : null;
}
