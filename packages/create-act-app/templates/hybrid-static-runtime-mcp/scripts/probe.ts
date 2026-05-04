/**
 * PRD-706-R10 / R18 — security probe harness for the runtime app mount.
 *
 * Two layers, identical to PRD-705's pattern (PRD-706-R6 inherits 705):
 *
 *   Layer 1 — `runTwoPrincipalProbe` from `@act-spec/runtime-core/test-utils`.
 *             Mandatory non-negotiable two-principal probe per PRD-705
 *             acceptance criterion (e). Verifies cross-tenant 404
 *             byte-equivalence + identical Link headers + each principal
 *             can see their own node.
 *
 *   Layer 2 — In-process HTTP transcript over the running hybrid server
 *             confirming step-(5)/(6)/(7) cross-tenant non-disclosure
 *             (404 byte-equivalence + cross-tenant ETag rejection).
 *
 * Failure of Layer 1 OR the security-gate subset of Layer 2 is a release
 * blocker (PRD-705-R20 / PRD-706-R10).
 */
/* eslint-disable no-console */
import {
  runTwoPrincipalProbe,
  type ProbePrincipal,
} from '@act-spec/runtime-core/test-utils';
import type { ActRequest, ActResponse } from '@act-spec/runtime-core';

import { actMount } from '../src/app/act-mount.js';
import { startServer } from '../src/app/server.js';
import { PROBE_FIXTURE } from '../src/lib/db.js';

interface ProbeFinding {
  step: string;
  ok: boolean;
  detail?: string;
}

const findings: ProbeFinding[] = [];

function record(step: string, ok: boolean, detail?: string): void {
  findings.push(detail !== undefined ? { step, ok, detail } : { step, ok });
}

// ---------------------------------------------------------------------------
// Layer 1 — runTwoPrincipalProbe
// ---------------------------------------------------------------------------

async function runHarness(): Promise<boolean> {
  const principalA: ProbePrincipal = {
    identity: { kind: 'principal', key: PROBE_FIXTURE.principalA.userId },
    tenant: { kind: 'scoped', key: PROBE_FIXTURE.principalA.tenantId },
    visibleNodeIds: ['doc/acme-roadmap-2026'],
  };
  const principalB: ProbePrincipal = {
    identity: { kind: 'principal', key: PROBE_FIXTURE.principalB.userId },
    tenant: { kind: 'scoped', key: PROBE_FIXTURE.principalB.tenantId },
    visibleNodeIds: ['doc/beta-launch-plan'],
  };

  const dispatchAs = async (
    principal: ProbePrincipal,
    req: ActRequest,
  ): Promise<ActResponse> => {
    const fixture =
      principal.identity.kind === 'principal' &&
      principal.identity.key === PROBE_FIXTURE.principalA.userId
        ? PROBE_FIXTURE.principalA
        : PROBE_FIXTURE.principalB;
    const headers = new Headers(req.headers);
    headers.set('authorization', `Bearer ${fixture.bearer}`);
    const nextReq = new Request(req.url.toString(), {
      method: req.method,
      headers,
    });
    // The two-principal harness builds URLs against the runtime's basePath
    // ('/app'). The mount's `node` handler reads catch-all params; we strip
    // the '/app/act/n/' prefix and pass the segment list per the App Router
    // convention.
    const path = req.url.pathname;
    const prefix = '/app/act/n/';
    const idEncoded = path.startsWith(prefix) ? path.slice(prefix.length) : '';
    const segments = idEncoded.split('/').map((s) => decodeURIComponent(s));
    const resp = await actMount.node(nextReq, { params: { id: segments } });
    return {
      status: resp.status,
      headers: resp.headers,
      body: await resp.text(),
    };
  };

  const report = await runTwoPrincipalProbe({
    runtime: actMount._instance,
    principalA,
    principalB,
    absentNodeId: 'doc/never-existed',
    dispatchAs,
  });

  for (const f of report.findings) {
    record(`harness/${f.check}`, f.passed, f.detail);
  }
  return report.passed;
}

// ---------------------------------------------------------------------------
// Layer 2 — HTTP transcript
// ---------------------------------------------------------------------------

interface CapturedResponse {
  status: number;
  headers: Headers;
  body: string;
}

async function http(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<CapturedResponse> {
  const resp = await fetch(`${baseUrl}${path}`, init);
  return { status: resp.status, headers: resp.headers, body: await resp.text() };
}

function authA(): RequestInit {
  return { headers: { authorization: `Bearer ${PROBE_FIXTURE.principalA.bearer}` } };
}
function authB(): RequestInit {
  return { headers: { authorization: `Bearer ${PROBE_FIXTURE.principalB.bearer}` } };
}

async function runTranscript(baseUrl: string): Promise<boolean> {
  let allOk = true;
  const fail = (step: string, detail: string): void => {
    record(step, false, detail);
    allOk = false;
  };
  const pass = (step: string): void => record(step, true);

  // Step 3 — A reads own doc → 200, capture ETag.
  const r3 = await http(baseUrl, '/app/act/n/doc/acme-roadmap-2026', authA());
  if (r3.status !== 200) {
    fail('R10/step-3: A reads own doc → 200', `got ${r3.status}; body=${r3.body.slice(0, 200)}`);
  } else {
    pass('R10/step-3: A reads own doc → 200');
  }
  const etagA = r3.headers.get('etag');
  if (!etagA) fail('R10/step-3: ETag header present', 'no ETag header');

  // Step 4 — A If-None-Match → 304.
  if (etagA) {
    const r4 = await http(baseUrl, '/app/act/n/doc/acme-roadmap-2026', {
      headers: { ...(authA().headers as Record<string, string>), 'if-none-match': etagA },
    });
    if (r4.status !== 304) {
      fail('R10/step-4: A If-None-Match → 304', `got ${r4.status}`);
    } else {
      pass('R10/step-4: A If-None-Match → 304');
    }
  }

  // Step 5 — B for A's doc → 404, byte-identical to absent.
  const r5_cross = await http(baseUrl, '/app/act/n/doc/acme-roadmap-2026', authB());
  const r5_absent = await http(baseUrl, '/app/act/n/doc/never-existed', authB());
  if (r5_cross.status !== 404) {
    fail('R10/step-5: cross-tenant → 404', `got ${r5_cross.status}`);
  } else if (r5_cross.body !== r5_absent.body) {
    fail(
      'R10/step-5: cross-tenant body == absent body',
      `cross=${r5_cross.body.slice(0, 120)} ; absent=${r5_absent.body.slice(0, 120)}`,
    );
  } else {
    pass('R10/step-5: cross-tenant 404 byte-equivalent to absent 404');
  }

  // Step 6 — A absent → 404 byte-identical to step 5.
  const r6 = await http(baseUrl, '/app/act/n/doc/never-existed', authA());
  if (r6.status !== 404) {
    fail('R10/step-6: A absent → 404', `got ${r6.status}`);
  } else if (r6.body !== r5_cross.body) {
    fail(
      'R10/step-6: absent body byte-identical to cross-tenant body',
      `absentA=${r6.body.slice(0, 120)} ; cross=${r5_cross.body.slice(0, 120)}`,
    );
  } else {
    pass('R10/step-6: A absent → 404 byte-identical to cross-tenant 404');
  }

  // Step 7 — B with A's ETag → NOT 304 (per-tenant ETag scope).
  if (etagA) {
    const r7 = await http(baseUrl, '/app/act/n/doc/acme-roadmap-2026', {
      headers: { ...(authB().headers as Record<string, string>), 'if-none-match': etagA },
    });
    if (r7.status === 304) {
      fail("R10/step-7: B with A's ETag → NOT 304", '304 leaked across tenants');
    } else {
      pass(`R10/step-7: B with A's ETag → ${r7.status} (not 304)`);
    }
  }

  return allOk;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('PRD-706 probe — Layer 1 (two-principal harness, in-process)');
  const layer1Ok = await runHarness();

  console.log('PRD-706 probe — Layer 2 (HTTP transcript on /app)');
  const { server, baseUrl } = await startServer(0);
  let layer2Ok: boolean;
  try {
    layer2Ok = await runTranscript(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }

  console.log('\nFindings:');
  for (const f of findings) {
    const mark = f.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${f.step}${f.detail ? `\n         ${f.detail}` : ''}`);
  }

  const securityGateChecks = findings.filter(
    (f) => /R10\/step-(5|6|7)/.test(f.step) || f.step.startsWith('harness/'),
  );
  const securityGateFailed = securityGateChecks.some((f) => !f.ok);

  if (!layer1Ok || layer2Ok === false || securityGateFailed) {
    console.error(
      `\nPRD-706 probe: FAILED${layer1Ok ? '' : ' (Layer 1)'}${layer2Ok ? '' : ' (Layer 2)'}${securityGateFailed ? ' (security gate)' : ''}`,
    );
    process.exit(1);
  }
  console.log('\nPRD-706 probe: OK — security gate green; harness + transcript pass.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
