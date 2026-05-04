/**
 * Public types for `@act-spec/inspector` — the PRD-601 inspector
 * library + CLI surface.
 *
 * The wire-format envelope types (`Manifest`, `Index`, `IndexEntry`,
 * `Node`, `Subtree`) are owned by `@act-spec/core` (PRD-100 codegen);
 * we re-export the inspector-result envelopes only.
 *
 * Per PRD-601-R14, every documented JSON field on these `Result`
 * shapes is part of the SemVer-stable surface — renaming or removing
 * one is MAJOR per PRD-108-R5.
 */

/**
 * A single inspector finding. PRD-601-R5(7), R8, R20, R21 enumerate
 * the codes; new codes are MINOR per the versioning table.
 */
export interface Finding {
  /** Stable, kebab-case classifier. Examples:
   *  - `manifest-parse-error`
   *  - `endpoint-404`
   *  - `auth-required`
   *  - `cross-origin-mount`
   *  - `cross-origin-mount-suppressed`
   *  - `request-budget-exceeded`
   *  - `version-mismatch`
   *  - `act-version-major-mismatch` (paired with CLI exit 4)
   *  - `level-mismatch` (e.g. subtree probed on a Core producer)
   *  - `subtree-requires-standard`
   *  - `ndjson-requires-strict`
   */
  code: string;
  message: string;
  /** RFC 6901 JSON Pointer when applicable (per PRD-601-R10 changesets). */
  pointer?: string;
  severity: 'info' | 'warn' | 'error';
}

/** Common options shared across every inspector entry point. */
export interface CommonOptions {
  /** Custom fetch adapter (e.g. to inject Authorization). PRD-601-R18. */
  fetch?: typeof globalThis.fetch;
  /** Total HTTP request budget per invocation (PRD-601-R20). */
  maxRequests?: number;
  /** Per-origin requests/sec (advisory; PRD-601-R20). */
  rateLimit?: number;
  /** Disable `If-None-Match` emission (PRD-601-R9). */
  noCache?: boolean;
  /** Suppress cross-origin mount fetches (PRD-601-R8). */
  noFollowCrossOrigin?: boolean;
  /** Inject HTTP request headers (PRD-601-R16, R18). NOT logged. */
  headers?: Record<string, string>;
}

// ---------- inspect (programmatic; sample-mode summary, PRD-601-R5) ----------

export interface InspectOptions extends CommonOptions {
  /** Sample N nodes (default 16). PRD-601-R5(4) / PRD-601-R17. */
  sample?: number;
}

export interface InspectResult {
  url: string;
  manifest: { value: unknown; findings: Finding[] };
  declared: {
    level: 'core' | 'standard' | 'strict' | null;
    delivery: 'static' | 'runtime' | null;
  };
  endpoints: {
    well_known: string;
    index: string | null;
    node_template: string | null;
    subtree_template?: string;
    index_ndjson?: string;
    search_template?: string;
  };
  auth: { schemes: string[] };
  sampled_nodes: Array<{
    id: string;
    type: string;
    title: string;
    tokens: { summary: number; abstract?: number; body?: number };
    etag: string;
    cache_hit: boolean;
  }>;
  tree_summary: {
    total_nodes: number;
    types: Record<string, number>;
    fanout: { min: number; max: number; mean: number; median: number };
    max_depth_observed: number;
  };
  findings: Finding[];
  walk_summary: { requests_made: number; elapsed_ms: number };
}

// ---------- walk (full discovery walk, PRD-601-R7) ----------

export interface WalkOptions extends CommonOptions {
  /** `'all'` (default) for a full walk; integer for sample-N. */
  sample?: number | 'all';
  /** Cap on `parent`-chain depth from `root_id`. */
  depth?: number;
  /** Plus only — fetch NDJSON index (PRD-601-R19). */
  useNdjson?: boolean;
}

export interface WalkResult {
  url: string;
  manifest: unknown;
  nodes: Array<{
    id: string;
    type: string;
    parent: string | null | undefined;
    children: string[];
    tokens: { summary: number; abstract?: number; body?: number };
    etag: string;
    status: 'ok' | 'error';
    findings?: Finding[];
  }>;
  tree_summary: InspectResult['tree_summary'];
  findings: Finding[];
  walk_summary: { requests_made: number; elapsed_ms: number };
}

// ---------- diff (PRD-601-R10 / R13) ----------

export interface DiffOptions extends CommonOptions {
  /** Fetch both nodes' bodies for `etag_changed` entries (PRD-601-R10). */
  includeContent?: boolean;
  /** Suppress per-field changes for these JSON pointers / dotted paths. */
  ignoreFields?: string[];
}

export interface DiffResult {
  url_a: string;
  url_b: string;
  added: Array<{ id: string }>;
  removed: Array<{ id: string }>;
  etag_unchanged: Array<{ id: string }>;
  etag_changed: Array<{
    id: string;
    token_delta: { summary: number; body: number };
    changes?: Array<{ pointer: string; before: unknown; after: unknown }>;
  }>;
  structural_change: Array<{
    id: string;
    parent_change?: { before: string | null | undefined; after: string | null | undefined };
    children_change?: { added: string[]; removed: string[] };
  }>;
  findings: Finding[];
  walk_summary: { requests_made: number; elapsed_ms: number };
}

// ---------- node, subtree (single envelope fetches) ----------

export type NodeOptions = CommonOptions;

export interface NodeResult {
  url: string;
  node: unknown;
  findings: Finding[];
}

export interface SubtreeOptions extends CommonOptions {
  /** Default 3, bounded to `[0, 8]` per PRD-601-R11. */
  depth?: number;
}

export interface SubtreeResult {
  url: string;
  subtree: unknown;
  findings: Finding[];
}

// ---------- budget (PRD-601-R12) ----------

export interface BudgetOptions extends CommonOptions {
  /** `'breadth-first'` (default) or `'deepest-first'`. PRD-601-R12. */
  strategy?: 'breadth-first' | 'deepest-first';
  /** Defaults to manifest's `root_id`. */
  startId?: string;
  /** Optional override; defaults to producer-declared `tokens.*`. */
  tokenizer?: (text: string) => number;
}

export interface BudgetResult {
  url: string;
  strategy: 'breadth-first' | 'deepest-first';
  max_tokens: number;
  start_id: string;
  inclusion_order: Array<{ id: string; tokens: number; cumulative_tokens: number }>;
  summary: {
    nodes_included: number;
    nodes_excluded: number;
    tokens_used: number;
    tokens_remaining: number;
  };
  findings: Finding[];
}
