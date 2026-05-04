/**
 * Internal test helpers shared between packages. Not published to npm.
 *
 *  - {@link loadFixture} — read JSON or NDJSON / .txt fixtures from `fixtures/`.
 *  - {@link listFixtures} — enumerate `fixtures/{NNN}/{positive|negative}/`.
 *  - {@link readExpectedError} — extract `_fixture_meta.expected_error` (or
 *    PRD-103-style `expected_finding`) from a negative fixture body.
 *  - {@link findGap} — assert a `gaps[]` entry citing a given requirement.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Gap, Warning } from '@act-spec/core';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repo root: packages/_test-utils/src → repo. Three levels up. */
export const REPO_ROOT = path.resolve(here, '..', '..', '..');
export const FIXTURES_ROOT = path.join(REPO_ROOT, 'fixtures');

/** Documented expected-error shape PRD-600 reporter is matched against. */
export interface ExpectedFinding {
  level?: string;
  requirement: string;
  missing: string;
  /** `error` (default) → `gaps[]`; `warning` → `warnings[]`; `integration-only` → skip schema-layer assertion. */
  kind?: 'error' | 'warning' | 'integration-only';
}

/** Polarity helper: positive vs negative branch under fixtures/{NNN}/ */
export type Polarity = 'positive' | 'negative';

/** Where in the fixture corpus a fixture lives. */
export interface FixtureRef {
  /** PRD series (numeric directory name, e.g. "100"). */
  series: string;
  polarity: Polarity;
  /** Basename including extension. */
  name: string;
  /** Absolute path. */
  filePath: string;
}

/**
 * Read a JSON fixture and return the parsed body. Strips the `_fixture_meta`
 * and `_negative_reason` and `_comment` sidecars before returning, so the
 * caller can pass the result straight to a schema validator.
 *
 * For non-JSON files (e.g. `.txt` HTTP transcripts), returns the raw string.
 */
export async function loadFixture(ref: FixtureRef): Promise<{
  body: unknown;
  meta: ExpectedFinding | undefined;
  raw: string;
}> {
  const raw = await fs.readFile(ref.filePath, 'utf8');
  if (!ref.name.endsWith('.json')) {
    return { body: raw, meta: undefined, raw };
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const meta = readExpectedError(parsed);
  // Strip sidecar meta fields (per schemas/README.md "Validators MUST strip these meta fields").
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (
      k.startsWith('_') ||
      k === 'expected_error' ||
      k === 'expected_finding' ||
      k === 'expected_validator_finding'
    )
      continue;
    cleaned[k] = v;
  }
  // PRD-103 fixtures sometimes wrap the envelope under `envelope: {...}`.
  // Unwrap when that's the only remaining key.
  const keys = Object.keys(cleaned);
  if (keys.length === 1 && keys[0] === 'envelope' && cleaned['envelope'] && typeof cleaned['envelope'] === 'object') {
    return { body: cleaned['envelope'], meta, raw };
  }
  return { body: cleaned, meta, raw };
}

/**
 * Extract the expected finding from a negative fixture's metadata. Supports
 * both conventions documented in `schemas/README.md`:
 *  1. `_fixture_meta.expected_error` (preferred for new fixtures).
 *  2. Top-level `expected_finding` / `expected_validator_finding` (PRD-103).
 *
 * Returns `undefined` if no expected-error block is present.
 */
export function readExpectedError(body: Record<string, unknown>): ExpectedFinding | undefined {
  const fm = body['_fixture_meta'];
  if (fm && typeof fm === 'object') {
    const exp = (fm as Record<string, unknown>)['expected_error'];
    if (exp && typeof exp === 'object') return exp as ExpectedFinding;
  }
  const top = body['expected_finding'] ?? body['expected_validator_finding'];
  if (top && typeof top === 'object') return top as ExpectedFinding;
  return undefined;
}

/**
 * List every fixture under `fixtures/{series}/{polarity}/`. Series and
 * polarity are filterable; passing `null` enumerates all.
 */
export async function listFixtures(
  series: readonly string[],
  polarity: Polarity | null = null,
): Promise<FixtureRef[]> {
  const results: FixtureRef[] = [];
  for (const s of series) {
    const polarities: Polarity[] = polarity ? [polarity] : ['positive', 'negative'];
    for (const p of polarities) {
      const dir = path.join(FIXTURES_ROOT, s, p);
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const name of entries.sort()) {
        results.push({ series: s, polarity: p, name, filePath: path.join(dir, name) });
      }
    }
  }
  return results;
}

/**
 * Find a `gaps[]` entry citing the given PRD requirement, returning it or
 * `undefined`. Used by negative-fixture assertions.
 */
export function findGap(gaps: readonly Gap[], requirement: string): Gap | undefined {
  return gaps.find((g) => g.requirement === requirement);
}

/** Like `findGap` but for `warnings[]`. */
export function findWarning(warnings: readonly Warning[], code: string): Warning | undefined {
  return warnings.find((w) => w.code === code);
}
