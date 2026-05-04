/**
 * Reporter assembly per PRD-600-R16 → R22 (anchored to PRD-107-R16 → R22).
 *
 * The conformance report shape is owned by PRD-107; this module emits it
 * verbatim — extra fields permitted via `additionalProperties` per
 * PRD-600-R31, but the seven required fields (`act_version`, `url`,
 * `declared`, `achieved`, `gaps`, `warnings`, `passed_at`) are never
 * removed or renamed.
 */
import type { AchievedLevel, ConformanceReport, DeliveryProfile, Gap, WalkSummary, Warning } from '@act-spec/core';
import { ACT_VERSION, VALIDATOR_VERSION } from './version.js';

export interface BuildReportInput {
  url: string;
  declared: { level: AchievedLevel | null; delivery: DeliveryProfile | null };
  achieved: { level: AchievedLevel | null; delivery: DeliveryProfile | null };
  gaps: readonly Gap[];
  warnings: readonly Warning[];
  walkSummary?: WalkSummary;
  /** Override RFC 3339 timestamp; defaults to now. Used by reproducibility tests. */
  passedAt?: string;
}

export function buildReport(input: BuildReportInput): ConformanceReport {
  const report: ConformanceReport = {
    act_version: ACT_VERSION,
    url: input.url,
    declared: input.declared,
    achieved: input.achieved,
    gaps: [...input.gaps],
    warnings: [...input.warnings],
    passed_at: input.passedAt ?? new Date().toISOString(),
    validator_version: VALIDATOR_VERSION,
  };
  if (input.walkSummary !== undefined) {
    report.walk_summary = input.walkSummary;
  }
  return report;
}

/**
 * Mandatory `search-body-deferred` warning per PRD-600-R24. Emitted whenever
 * the manifest advertises `search_url_template`, regardless of any other
 * Plus-level findings.
 */
export function searchBodyDeferredWarning(manifest: unknown): Warning[] {
  if (!manifest || typeof manifest !== 'object') return [];
  if (!('search_url_template' in manifest)) return [];
  return [
    {
      level: 'strict',
      code: 'search-body-deferred',
      message:
        "search response body envelope is deferred to v0.2 per Q13; PRD-600 v0.1 validates only template presence and that the endpoint returns 200 JSON. The body's shape is not asserted.",
    },
  ];
}

/**
 * Per PRD-600-R18, infer the achieved level by probing in band order:
 * Core → Standard → Plus. Any gap whose `level === 'core'` blocks Standard
 * or Plus from being achieved.
 *
 * The `declaredLevel` parameter is consulted only for the achieved-cap rule:
 * a producer that did not declare Plus can still *achieve* Plus by passing
 * every Plus-tier check, so we do NOT cap by declaration.
 */
export function inferAchievedLevel(gaps: readonly Gap[]): AchievedLevel | null {
  let coreOk = true;
  let standardOk = true;
  let strictOk = true;
  for (const g of gaps) {
    if (g.level === 'core') coreOk = false;
    if (g.level === 'standard') standardOk = false;
    if (g.level === 'strict') strictOk = false;
  }
  if (!coreOk) return null;
  if (!standardOk) return 'core';
  if (!strictOk) return 'standard';
  return 'strict';
}
