/**
 * PRD-705-R19 — validator gate.
 *
 * Boots the example HTTP server, runs `@act-spec/validator`'s `validateSite`
 * in runtime-walk mode with credentials injected (PRD-600-R32 / PRD-705-R18
 * step h), and asserts:
 *
 *   - `gaps.length === 0`
 *   - `declared.level === 'standard'`
 *   - `achieved.level === 'standard'` (achieved == declared per PRD-107-R16)
 *   - `delivery === 'runtime'`
 *
 * Exits non-zero on any miss.
 */
/* eslint-disable no-console */
import { validateSite } from '@act-spec/validator';

import { startServer } from '../src/lib/server.js';
import { PROBE_FIXTURE } from '../src/lib/db.js';

async function main(): Promise<void> {
  const { server, baseUrl } = await startServer(0);
  try {
    // Credential-injecting fetch adapter per PRD-600-R32 / PRD-705-R18.
    // Principal A's bearer is the validator's "service identity" view of
    // the workspace.
    const authedFetch: typeof globalThis.fetch = (input, init = {}) => {
      const headers = new Headers((init as RequestInit).headers ?? {});
      headers.set('authorization', `Bearer ${PROBE_FIXTURE.principalA.bearer}`);
      return fetch(input as Parameters<typeof fetch>[0], { ...(init as RequestInit), headers });
    };

    const report = await validateSite(`${baseUrl}/.well-known/act.json`, {
      fetch: authedFetch,
      passedAt: '2026-05-02T00:00:00Z',
    });

    console.log(
      `PRD-705 conformance — ${report.walk_summary?.nodes_sampled ?? 0} nodes sampled.`,
    );
    console.log(`  declared:  ${report.declared.level ?? '<unknown>'} / ${report.declared.delivery ?? '<unknown>'}`);
    console.log(`  achieved:  ${report.achieved.level ?? '<none>'} / ${report.achieved.delivery ?? '<unknown>'}`);
    console.log(`  gaps:      ${report.gaps.length}`);
    console.log(`  warnings:  ${report.warnings.length}`);

    let failed = 0;
    if (report.gaps.length > 0) {
      failed += 1;
      console.error(`FAIL: ${report.gaps.length} gap(s)`);
      for (const g of report.gaps) console.error(`  [${g.level}] ${g.requirement}: ${g.missing}`);
    }
    if (report.declared.level !== 'standard') {
      failed += 1;
      console.error(`FAIL: declared.level is "${report.declared.level}", expected "standard" (PRD-705-R2).`);
    }
    if (report.achieved.level !== 'standard') {
      failed += 1;
      console.error(`FAIL: achieved.level is "${report.achieved.level}", expected "standard" (PRD-705-R19).`);
    }
    if (report.declared.delivery !== 'runtime' || report.achieved.delivery !== 'runtime') {
      failed += 1;
      console.error(
        `FAIL: delivery profile is not "runtime" (declared=${report.declared.delivery ?? '<unknown>'}, achieved=${report.achieved.delivery ?? '<unknown>'}; PRD-705-R5).`,
      );
    }

    if (failed > 0) {
      console.error(`\nPRD-705 conformance: FAILED (${failed} check(s)).`);
      process.exit(1);
    }
    console.log(
      `\nPRD-705 conformance: OK — gaps: 0; declared.level: standard; achieved.level: standard; delivery: runtime.`,
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
