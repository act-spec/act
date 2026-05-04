/**
 * Per-envelope structural + cross-cutting validation (PRD-600-R1 → R15).
 *
 * Public entry points (PRD-600-R25):
 *   - {@link validateManifest}
 *   - {@link validateNode}
 *   - {@link validateIndex}
 *   - {@link validateNdjsonIndex}
 *   - {@link validateSubtree}
 *   - {@link validateError}
 *
 * Each returns a `ValidationResult` (gaps + warnings, no `declared`/`achieved`
 * band reporting; see {@link reporter} for the full conformance shape).
 */
import type { Gap, ValidationResult, Warning } from '@act-spec/core';
import { ajvErrorToRequirement, getCompiledSchemas } from './schemas.js';
import { ETAG_LOOSE_RE, ETAG_S256_RE, deriveEtag, deriveEtagFromCanonicalBytes } from './etag.js';
import { findChildrenCycle, hasSelfCycle } from './cycles.js';
import { findMountOverlaps } from './mounts.js';

/** Options accepted by every per-envelope validator (PRD-600-R25). */
export interface ValidateOptions {
  /** When true, schema warnings are upgraded to errors. */
  strictWarnings?: boolean;
  /** Suppress these warning codes. */
  ignoreWarnings?: readonly string[];
  /** Pin the validator to an explicit act_version; defaults to bundled. */
  actVersion?: string;
}

interface RawIndexEntry {
  id?: unknown;
  etag?: unknown;
  summary?: unknown;
  tokens?: { summary?: unknown };
}

/** Coerce a string-or-object input into a parsed object (or throw a gap). */
function parseInput(input: unknown, envelope: string): { ok: true; value: unknown } | { ok: false; gap: Gap } {
  if (typeof input === 'string') {
    try {
      return { ok: true, value: JSON.parse(input) };
    } catch {
      return {
        ok: false,
        gap: {
          level: 'core',
          requirement: 'PRD-100-R3',
          missing: `${envelope} input is not valid JSON.`,
        },
      };
    }
  }
  return { ok: true, value: input };
}

function mkResult(gaps: readonly Gap[], warnings: readonly Warning[]): ValidationResult {
  return { ok: gaps.length === 0, gaps: [...gaps], warnings: [...warnings] };
}

/**
 * Apply `strictWarnings` / `ignoreWarnings` post-processing per
 * PRD-600-R25 / R26.
 */
function applyOptions(
  gaps: Gap[],
  warnings: Warning[],
  opts: ValidateOptions | undefined,
): ValidationResult {
  let w = warnings;
  if (opts?.ignoreWarnings && opts.ignoreWarnings.length > 0) {
    const ignore = new Set(opts.ignoreWarnings);
    w = w.filter((x) => !ignore.has(x.code));
  }
  let g = gaps;
  if (opts?.strictWarnings) {
    // Upgrade remaining warnings to errors per PRD-600-R26 / R27.
    g = [
      ...g,
      ...w.map<Gap>((x) => ({
        level: x.level,
        requirement: 'PRD-600-R26',
        missing: `[strict-warnings] ${x.code}: ${x.message}`,
      })),
    ];
    w = [];
  }
  return mkResult(g, w);
}

/** Run ajv on the parsed value and translate its errors into PRD-cited gaps. */
function runSchema(
  envelope: 'manifest' | 'index' | 'indexEntry' | 'node' | 'subtree' | 'error',
  value: unknown,
): Gap[] {
  const schemas = getCompiledSchemas();
  const fn = schemas[envelope];
  const valid = fn(value);
  if (valid) return [];
  // Ajv guarantees `errors` is populated when `valid === false`, and every
  // keyword we exercise carries a `message`. We keep these as plain reads
  // (no `??` defaults) — fall-through would be a schema-bundle bug we want
  // to surface as a TypeError, not silently mask.
  const errors = fn.errors as unknown as readonly { instancePath: string; message: string; keyword: string; params: Record<string, unknown> }[];
  return errors.map<Gap>((err) => ({
    level: 'core',
    requirement: ajvErrorToRequirement(envelope, err as Parameters<typeof ajvErrorToRequirement>[1]),
    missing: `${err.instancePath || '/'} ${err.message}`.trim(),
  }));
}

/** Validate a top-level `etag` field's value-shape (PRD-600-R6). */
function checkEtagShape(etag: unknown, where: string): Gap[] {
  if (typeof etag !== 'string') {
    return [
      {
        level: 'core',
        requirement: 'PRD-103-R1',
        missing: `${where}: etag missing or not a string.`,
      },
    ];
  }
  if (!ETAG_LOOSE_RE.test(etag)) {
    return [
      {
        level: 'core',
        requirement: 'PRD-103-R2',
        missing: `${where}: etag value ${JSON.stringify(etag)} fails general value-shape regex.`,
      },
    ];
  }
  if (!ETAG_S256_RE.test(etag)) {
    return [
      {
        level: 'core',
        requirement: 'PRD-103-R3',
        missing: `${where}: etag ${JSON.stringify(etag)} not in v0.1 admit-list (s256:[A-Za-z0-9_-]{22}).`,
      },
    ];
  }
  return [];
}

/** PRD-600 / Manifest. */
export function validateManifest(
  input: unknown,
  opts?: ValidateOptions,
): ValidationResult {
  const parsed = parseInput(input, 'manifest');
  if (!parsed.ok) return mkResult([parsed.gap], []);
  const gaps = runSchema('manifest', parsed.value);
  const warnings: Warning[] = [];

  // Cross-cutting: mount overlap (PRD-100-R7 / PRD-106-R20).
  const value = (parsed.value ?? {}) as { mounts?: unknown };
  if (Array.isArray(value.mounts)) {
    for (const f of findMountOverlaps(value.mounts as { prefix?: unknown }[])) {
      gaps.push({ level: 'core', requirement: f.requirement, missing: f.missing });
    }
  }

  // Unknown-field warning (PRD-600-R4): we currently apply this only to the
  // manifest envelope, where the spec carries a stable documented set. The
  // open-default elsewhere keeps positive fixtures clean.
  warnings.push(...detectUnknownManifestFields(parsed.value));

  return applyOptions(gaps, warnings, opts);
}

const KNOWN_MANIFEST_FIELDS = new Set([
  'act_version',
  'site',
  'generated_at',
  'generator',
  'index_url',
  'index_ndjson_url',
  'node_url_template',
  'subtree_url_template',
  'search_url_template',
  'root_id',
  'stats',
  'capabilities',
  'conformance',
  'delivery',
  'mounts',
  'policy',
]);

function detectUnknownManifestFields(value: unknown): Warning[] {
  // Caller always supplies the parsed envelope; non-object inputs would
  // have been caught earlier by `parseInput`.
  const warnings: Warning[] = [];
  if (typeof value !== 'object' || value === null) return warnings;
  for (const k of Object.keys(value)) {
    if (!KNOWN_MANIFEST_FIELDS.has(k)) {
      warnings.push({
        level: 'core',
        code: 'unknown-field',
        message: `manifest carries unknown top-level field ${JSON.stringify(k)}; tolerated per PRD-108-R7.`,
      });
    }
  }
  return warnings;
}

/** PRD-600 / Node. */
export function validateNode(input: unknown, opts?: ValidateOptions): ValidationResult {
  const parsed = parseInput(input, 'node');
  if (!parsed.ok) return mkResult([parsed.gap], []);
  const gaps = runSchema('node', parsed.value);
  const warnings: Warning[] = [];

  const node = parsed.value as { etag?: unknown; id?: unknown; tokens?: { body?: unknown } };
  // PRD-600-R6: etag value-shape.
  if ('etag' in node) {
    gaps.push(...checkEtagShape(node.etag, `/etag (node ${idForLog(node.id)})`));
  }
  // PRD-600-R13: children cycle (single-envelope self-reference).
  if (hasSelfCycle(node)) {
    gaps.push({
      level: 'core',
      requirement: 'PRD-100-R25',
      missing: `node ${idForLog(node.id)} lists itself in children — children-graph cycle.`,
    });
  }
  // PRD-100-R27: body-tokens warning at 10000.
  const body = node.tokens?.body;
  if (typeof body === 'number' && body > 10000) {
    warnings.push({
      level: 'core',
      code: 'body-tokens',
      message: `node ${idForLog(node.id)} tokens.body=${body} exceeds 10000 SHOULD-split threshold (PRD-100-R27).`,
    });
  }

  return applyOptions(gaps, warnings, opts);
}

function idForLog(id: unknown): string {
  return typeof id === 'string' ? id : '<unknown>';
}

/** PRD-600 / Index (JSON form). */
export function validateIndex(
  input: unknown,
  opts?: ValidateOptions,
): ValidationResult {
  const parsed = parseInput(input, 'index');
  if (!parsed.ok) return mkResult([parsed.gap], []);
  const gaps = runSchema('index', parsed.value);
  const warnings: Warning[] = [];

  const idx = parsed.value as { etag?: unknown; nodes?: unknown };
  // The index top-level `etag` field is left open by the locked
  // schemas/100/index.schema.json (no pattern). Per amendment A7, PRD-600 v0.1
  // does NOT enforce the strict PRD-103-R3 admit-list on the index
  // top-level etag — only on the per-entry etags (which DO carry the
  // pattern at the schema layer per PRD-100-R17 / PRD-103-R1).
  if (Array.isArray(idx.nodes)) {
    for (let i = 0; i < idx.nodes.length; i += 1) {
      const e = idx.nodes[i] as RawIndexEntry;
      gaps.push(...checkEtagShape(e?.etag, `/nodes/${i}/etag`));
      // PRD-100-R20 summary-length warning at 100 tokens.
      const summaryTokens = e?.tokens?.summary;
      if (typeof summaryTokens === 'number' && summaryTokens > 100) {
        warnings.push({
          level: 'core',
          code: 'summary-length',
          message: `index entry ${idForLog(e.id)} tokens.summary=${summaryTokens} exceeds 100-token warning threshold (PRD-100-R20).`,
        });
      }
    }
  }
  return applyOptions(gaps, warnings, opts);
}

/** PRD-600 / NDJSON Index (PRD-100-R37). */
export function validateNdjsonIndex(input: string, opts?: ValidateOptions): ValidationResult {
  if (typeof input !== 'string') {
    return mkResult(
      [
        {
          level: 'core',
          requirement: 'PRD-100-R37',
          missing: 'NDJSON index input must be a string.',
        },
      ],
      [],
    );
  }
  const lines = input.split('\n');
  const gaps: Gap[] = [];
  const warnings: Warning[] = [];
  const schemas = getCompiledSchemas();
  let lineno = 0;
  for (const raw of lines) {
    lineno += 1;
    if (raw.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      gaps.push({
        level: 'strict',
        requirement: 'PRD-100-R37',
        missing: `NDJSON line ${lineno} is not valid JSON.`,
      });
      continue;
    }
    if (parsed && typeof parsed === 'object' && 'act_version' in parsed) {
      gaps.push({
        level: 'strict',
        requirement: 'PRD-100-R2',
        missing: `NDJSON line ${lineno} carries act_version; per PRD-100-R2 lines MUST NOT.`,
      });
    }
    const valid = schemas.indexEntry(parsed);
    if (!valid) {
      const errors = schemas.indexEntry.errors as unknown as readonly {
        instancePath: string;
        message: string;
        keyword: string;
        params: Record<string, unknown>;
      }[];
      for (const err of errors) {
        gaps.push({
          level: 'strict',
          requirement: ajvErrorToRequirement(
            'indexEntry',
            err as Parameters<typeof ajvErrorToRequirement>[1],
          ),
          missing: `NDJSON line ${lineno}: ${err.instancePath || '/'} ${err.message}`.trim(),
        });
      }
    }
    const etagValue = (parsed as { etag?: unknown }).etag;
    gaps.push(...checkEtagShape(etagValue, `NDJSON line ${lineno} /etag`).map<Gap>((g) => ({ ...g, level: 'strict' })));
  }
  return applyOptions(gaps, warnings, opts);
}

/** PRD-600 / Subtree. */
export function validateSubtree(
  input: unknown,
  opts?: ValidateOptions,
): ValidationResult {
  const parsed = parseInput(input, 'subtree');
  if (!parsed.ok) return mkResult([parsed.gap], []);
  const gaps = runSchema('subtree', parsed.value);
  const warnings: Warning[] = [];

  const sub = parsed.value as {
    etag?: unknown;
    depth?: unknown;
    nodes?: unknown;
    root?: unknown;
  };
  // The subtree top-level `etag` field is left open by the locked
  // schemas/100/subtree.schema.json (no pattern, just `string`). Per
  // amendment A7, PRD-600 v0.1 does NOT enforce the strict PRD-103-R3
  // admit-list on the subtree top-level etag — only on per-node etags
  // inside `nodes[]` (which DO carry the strict pattern via the node schema's
  // etag field flowing through the node validator).
  // PRD-600-R15: subtree depth bound (PRD-100-R33).
  if (typeof sub.depth === 'number' && sub.depth > 8) {
    gaps.push({
      level: 'standard',
      requirement: 'PRD-100-R33',
      missing: `subtree depth ${sub.depth} exceeds documented maximum 8.`,
    });
  }
  // PRD-600-R15: depth-first pre-order with root first (PRD-100-R35).
  if (Array.isArray(sub.nodes) && sub.nodes.length > 0 && typeof sub.root === 'string') {
    const first = sub.nodes[0] as { id?: unknown };
    if (typeof first.id === 'string' && first.id !== sub.root) {
      gaps.push({
        level: 'standard',
        requirement: 'PRD-100-R35',
        missing: `subtree nodes[0].id=${JSON.stringify(first.id)} is not root=${JSON.stringify(sub.root)}.`,
      });
    }
  }
  // Per-node etag shape and cross-node cycle detection.
  if (Array.isArray(sub.nodes)) {
    for (let i = 0; i < sub.nodes.length; i += 1) {
      const n = sub.nodes[i] as { etag?: unknown };
      gaps.push(...checkEtagShape(n?.etag, `/nodes/${i}/etag`));
    }
    const cycle = findChildrenCycle(sub.nodes as { id?: unknown; children?: unknown }[]);
    if (cycle) {
      gaps.push({
        level: 'core',
        requirement: 'PRD-100-R25',
        missing: `subtree children graph contains a cycle: ${cycle.join(' -> ')}.`,
      });
    }
  }

  return applyOptions(gaps, warnings, opts);
}

/** PRD-600 / Error envelope. */
export function validateError(
  input: unknown,
  opts?: ValidateOptions,
): ValidationResult {
  const parsed = parseInput(input, 'error');
  if (!parsed.ok) return mkResult([parsed.gap], []);
  const gaps = runSchema('error', parsed.value);
  return applyOptions(gaps, [], opts);
}

/**
 * Re-derive an etag (PRD-600-R7). Used by the determinism prober and by
 * fixtures under `fixtures/103/positive/` that bundle a canonical-bytes
 * input alongside the expected `s256:...` value.
 */
export function reDeriveEtagAndCheck(input: {
  /** Pre-canonicalized bytes (skip JCS step). */
  canonicalBytes?: string;
  /** Or: full envelope payload that will be JCS-canonicalized after stripping `etag`. */
  payloadMinusEtag?: unknown;
  /** Expected `s256:...` value to match against. */
  expected: string;
  /** Profile under which the recipe applies (controls which PRD requirement is cited). */
  profile: 'static' | 'runtime';
}): Gap[] {
  const computed =
    input.canonicalBytes !== undefined
      ? deriveEtagFromCanonicalBytes(input.canonicalBytes)
      : deriveEtag(input.payloadMinusEtag);
  if (computed === input.expected) return [];
  const requirement = input.profile === 'static' ? 'PRD-103-R4' : 'PRD-103-R6';
  return [
    {
      level: 'core',
      requirement,
      missing: `etag re-derivation mismatch: computed=${computed}, expected=${input.expected}.`,
    },
  ];
}
