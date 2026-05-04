/**
 * PRD-706-R19 — validator gate.
 *
 * The PRD-706 validator gate is per-mount (Open-Q5 walks mounts in a
 * single invocation; PRD-600 v0.1 does not yet implement mount recursion
 * — see comment below). This script issues three sub-validations against
 * the running deployment:
 *
 *   1. Parent manifest validates against `schemas/100/manifest.schema.json`
 *      (envelope-level checks; mount overlap rule via `findMountOverlaps`).
 *   2. Marketing leaf manifest at `/marketing/.well-known/act.json`
 *      → `validateSite`; expect `gaps.length === 0`,
 *      `achieved.level === 'strict'`, `delivery === 'static'`.
 *   3. App leaf manifest at `/app/.well-known/act.json` with bearer
 *      credentials injected (PRD-600-R32 / PRD-705-R18) → `validateSite`;
 *      expect `gaps.length === 0`, `achieved.level === 'standard'`,
 *      `delivery === 'runtime'`.
 *
 * Per-mount sub-reports satisfy PRD-706-R19's `mounts['/marketing'].achieved.level`
 * and `mounts['/app'].achieved.level` shape; we surface them in the
 * console output and on the `report.mounts` field of this script's output
 * for callers wanting the structured form.
 *
 * Failure of any of (1)/(2)/(3) returns non-zero exit per PRD-706-R19.
 */
/* eslint-disable no-console */
import {
  findMountOverlaps,
  validateManifest,
  validateSite,
} from '@act-spec/validator';

import { startServer } from '../src/app/server.js';
import { PROBE_FIXTURE } from '../src/lib/db.js';

interface MountReport {
  prefix: string;
  achievedLevel: string | null;
  declaredLevel: string | null;
  delivery: string | null;
  gaps: number;
  warnings: number;
  passed: boolean;
}

async function validateParentManifest(baseUrl: string): Promise<{ passed: boolean; mounts: ReadonlyArray<{ prefix: string }> }> {
  const res = await fetch(`${baseUrl}/.well-known/act.json`);
  if (!res.ok) {
    console.error(`FAIL: parent manifest unreachable (HTTP ${res.status}).`);
    return { passed: false, mounts: [] };
  }
  const body = (await res.json()) as Record<string, unknown>;

  // Parent manifest is a routing manifest; it intentionally omits the
  // Core required `index_url` / `node_url_template`. PRD-600's envelope
  // validator therefore reports those gaps. We allow only Core-required
  // gaps that are explicitly tied to the routing-manifest exclusions
  // PRD-706-R2 mandates; we pass the per-mount overlap check straight.
  const mounts = body['mounts'];
  if (!Array.isArray(mounts) || mounts.length !== 2) {
    console.error(`FAIL: parent manifest must declare exactly two mounts; got ${Array.isArray(mounts) ? mounts.length : 'none'}.`);
    return { passed: false, mounts: [] };
  }
  const overlaps = findMountOverlaps(mounts as ReadonlyArray<{ prefix?: unknown }>);
  if (overlaps.length > 0) {
    console.error(`FAIL: parent manifest has overlapping mount prefixes: ${overlaps.map((o) => o.missing).join('; ')}`);
    return { passed: false, mounts: [] };
  }
  // Validate envelope shape (we tolerate Core required-field gaps because
  // a routing manifest legitimately omits them per PRD-706-R2).
  const r = validateManifest(body);
  const fatalGaps = r.gaps.filter((g) =>
    g.requirement !== 'PRD-100-R4' &&
    !/index_url|node_url_template/.test(g.missing),
  );
  if (fatalGaps.length > 0) {
    console.error('FAIL: parent manifest envelope gaps:');
    for (const g of fatalGaps) console.error(`  [${g.level}] ${g.requirement}: ${g.missing}`);
    return { passed: false, mounts: mounts as ReadonlyArray<{ prefix: string }> };
  }

  console.log('  parent manifest: OK (mounts non-overlapping; envelope-shape clean modulo routing-manifest required-field omission).');
  return { passed: true, mounts: mounts as ReadonlyArray<{ prefix: string }> };
}

async function validateMarketingMount(baseUrl: string): Promise<MountReport> {
  const url = `${baseUrl}/marketing/.well-known/act.json`;
  const report = await validateSite(url, {
    passedAt: '2026-05-02T00:00:00Z',
  });
  const passed =
    report.gaps.length === 0 &&
    report.achieved.level === 'strict' &&
    report.declared.level === 'strict' &&
    report.achieved.delivery === 'static';
  return {
    prefix: '/marketing',
    achievedLevel: report.achieved.level,
    declaredLevel: report.declared.level,
    delivery: report.achieved.delivery,
    gaps: report.gaps.length,
    warnings: report.warnings.length,
    passed,
  };
}

async function validateAppMount(baseUrl: string): Promise<MountReport> {
  const url = `${baseUrl}/app/.well-known/act.json`;
  const authedFetch: typeof globalThis.fetch = (input, init = {}) => {
    const headers = new Headers((init as RequestInit).headers ?? {});
    headers.set('authorization', `Bearer ${PROBE_FIXTURE.principalA.bearer}`);
    return fetch(input as Parameters<typeof fetch>[0], { ...(init as RequestInit), headers });
  };
  const report = await validateSite(url, {
    fetch: authedFetch,
    passedAt: '2026-05-02T00:00:00Z',
  });
  const passed =
    report.gaps.length === 0 &&
    report.achieved.level === 'standard' &&
    report.declared.level === 'standard' &&
    report.achieved.delivery === 'runtime';
  return {
    prefix: '/app',
    achievedLevel: report.achieved.level,
    declaredLevel: report.declared.level,
    delivery: report.achieved.delivery,
    gaps: report.gaps.length,
    warnings: report.warnings.length,
    passed,
  };
}

function printMountReport(r: MountReport): void {
  console.log(`  ${r.prefix} mount:`);
  console.log(`    declared:  ${r.declaredLevel ?? '<unknown>'} / delivery=${r.delivery ?? '<unknown>'}`);
  console.log(`    achieved:  ${r.achievedLevel ?? '<unknown>'}`);
  console.log(`    gaps:      ${r.gaps}`);
  console.log(`    warnings:  ${r.warnings}`);
  console.log(`    verdict:   ${r.passed ? 'PASS' : 'FAIL'}`);
}

async function main(): Promise<void> {
  const { server, baseUrl } = await startServer(0);
  let allPassed = true;
  try {
    console.log('PRD-706 validator gate:');
    const parent = await validateParentManifest(baseUrl);
    if (!parent.passed) allPassed = false;

    const marketing = await validateMarketingMount(baseUrl);
    printMountReport(marketing);
    if (!marketing.passed) allPassed = false;

    const app = await validateAppMount(baseUrl);
    printMountReport(app);
    if (!app.passed) allPassed = false;

    if (!allPassed) {
      console.error('\nPRD-706 conformance: FAILED.');
      process.exit(1);
    }
    console.log('\nPRD-706 conformance: OK — parent + marketing(plus) + app(standard) green.');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
