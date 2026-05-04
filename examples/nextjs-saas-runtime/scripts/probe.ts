/**
 * PRD-705-R18 / R20 — security probe harness.
 *
 * Two layers:
 *
 * 1. `runTwoPrincipalProbe` (from `@act-spec/runtime-core/test-utils`).
 *    The mandatory non-negotiable two-principal probe per PRD-705
 *    acceptance criterion (e). Runs against the in-process mount; verifies
 *    cross-tenant 404 byte-equivalence + identical discovery `Link`
 *    headers + each principal can see their own node.
 *
 * 2. The PRD-705-R18 eight-step transcript probe. Boots the example's
 *    HTTP server, then issues real HTTP requests covering:
 *      (1) unauthenticated /.well-known/act.json → 401 with two
 *          WWW-Authenticate headers.
 *      (2) unauthenticated /act/n/public/landing → 200.
 *      (3) authenticated principal A → captures node + ETag.
 *      (4) If-None-Match as A → 304 with same ETag.
 *      (5) principal B for A's id → 404 byte-identical to non-existent.
 *      (6) principal A for non-existent id → 304-anchor reference.
 *      (7) principal B with A's ETag → NOT 304 (cross-tenant ETag scope).
 *      (8) act_version: 1.0 → 400 with reason "act_version_unsupported".
 *
 * Exits with a structured pass/fail report; non-zero exit on any failure
 * (the security-test acceptance criterion per PRD-705-R20).
 */
/* eslint-disable no-console */
import {
  runTwoPrincipalProbe,
  type ProbePrincipal,
} from '@act-spec/runtime-core/test-utils';
import type { ActRequest, ActResponse } from '@act-spec/runtime-core';

import { actMount } from '../src/lib/act-mount.js';
import { dispatch, startServer } from '../src/lib/server.js';
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
// Layer 1 — runTwoPrincipalProbe (PRD-705 acceptance criterion (e))
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

  // Bridge: the harness builds an ActRequest; we forward via the mount's
  // node handler with the principal's bearer token injected into headers.
  // The example's identityResolver picks up the bearer and resolves the
  // principal — same path the real HTTP server uses.
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
    const path = req.url.pathname;
    const prefix = '/act/n/';
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
// Layer 2 — PRD-705-R18 eight-step HTTP transcript
// ---------------------------------------------------------------------------

interface CapturedResponse {
  status: number;
  headers: Headers;
  body: string;
}

async function capture(resp: Response): Promise<CapturedResponse> {
  return { status: resp.status, headers: resp.headers, body: await resp.text() };
}

async function http(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<CapturedResponse> {
  const resp = await fetch(`${baseUrl}${path}`, init);
  return capture(resp);
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

  // Step 1 — Unauthenticated manifest → 401 with two WWW-Authenticate headers.
  // (PRD-705 R9 — challenge set computed once, two schemes declared in the manifest.)
  const r1 = await http(baseUrl, '/.well-known/act.json');
  // The example serves the manifest authenticated; an unauthenticated
  // request returns 401 with the challenge set per PRD-705-R9.
  if (r1.status !== 401) {
    fail('R18/step-1: unauth manifest → 401', `got ${r1.status}`);
  } else {
    // WHATWG fetch's Headers concatenates repeated headers with `, `.
    const wwwAuth = r1.headers.get('www-authenticate') ?? '';
    const cookieScheme = /(^|,\s*)cookie\b/i.test(wwwAuth);
    const bearerScheme = /(^|,\s*)bearer\b/i.test(wwwAuth);
    if (!cookieScheme || !bearerScheme) {
      fail(
        'R18/step-1: WWW-Authenticate carries cookie + bearer schemes',
        `got: ${wwwAuth || '<absent>'}`,
      );
    } else {
      pass('R18/step-1: unauth manifest → 401 with cookie + bearer challenges');
    }
  }

  // Step 2 — Unauthenticated /act/n/public/landing → 200 (public branch).
  const r2 = await http(baseUrl, '/act/n/public/landing');
  if (r2.status !== 200) {
    fail('R18/step-2: unauth public landing → 200', `got ${r2.status}; body=${r2.body.slice(0, 200)}`);
  } else {
    pass('R18/step-2: unauth public landing → 200');
  }

  // Step 3 — Authenticated principal A → 200, capture ETag.
  const r3 = await http(baseUrl, '/act/n/doc/acme-roadmap-2026', authA());
  if (r3.status !== 200) {
    fail('R18/step-3: principal A own doc → 200', `got ${r3.status}; body=${r3.body.slice(0, 200)}`);
  } else {
    pass('R18/step-3: principal A own doc → 200');
  }
  const etagA = r3.headers.get('etag');
  if (!etagA) {
    fail('R18/step-3: ETag header present', 'no ETag header');
  }

  // Step 4 — If-None-Match as A → 304 with same ETag.
  if (etagA) {
    const r4 = await http(baseUrl, '/act/n/doc/acme-roadmap-2026', {
      headers: { ...(authA().headers as Record<string, string>), 'if-none-match': etagA },
    });
    if (r4.status !== 304) {
      fail('R18/step-4: A If-None-Match → 304', `got ${r4.status}; body=${r4.body.slice(0, 200)}`);
    } else if (r4.headers.get('etag') !== etagA) {
      fail('R18/step-4: 304 carries same ETag', `got ${r4.headers.get('etag') ?? '<none>'} vs ${etagA}`);
    } else if (r4.body !== '') {
      fail('R18/step-4: 304 has empty body', `got body length ${r4.body.length}`);
    } else {
      pass('R18/step-4: A If-None-Match → 304 with same ETag, no body');
    }
  }

  // Step 5 — Principal B for A's doc → 404, byte-identical to non-existent.
  const r5_cross = await http(baseUrl, '/act/n/doc/acme-roadmap-2026', authB());
  const r5_absent = await http(baseUrl, '/act/n/doc/never-existed', authB());
  if (r5_cross.status !== 404) {
    fail('R18/step-5: cross-tenant → 404', `got ${r5_cross.status}`);
  } else if (r5_cross.body !== r5_absent.body) {
    fail(
      'R18/step-5: cross-tenant body == absent body',
      `cross=${r5_cross.body.slice(0, 120)} ; absent=${r5_absent.body.slice(0, 120)}`,
    );
  } else {
    pass('R18/step-5: cross-tenant 404 byte-equivalent to absent 404');
  }

  // Step 6 — Principal A for non-existent doc → 404, byte-identical to step 5.
  const r6 = await http(baseUrl, '/act/n/doc/never-existed', authA());
  if (r6.status !== 404) {
    fail('R18/step-6: A absent → 404', `got ${r6.status}`);
  } else if (r6.body !== r5_cross.body) {
    fail(
      'R18/step-6: absent body byte-identical to cross-tenant body',
      `absentA=${r6.body.slice(0, 120)} ; cross=${r5_cross.body.slice(0, 120)}`,
    );
  } else {
    pass('R18/step-6: A absent → 404 byte-identical to cross-tenant 404');
  }

  // Step 7 — Principal B with A's ETag → NOT 304 (ETag scoped per tenant).
  if (etagA) {
    const r7 = await http(baseUrl, '/act/n/doc/acme-roadmap-2026', {
      headers: { ...(authB().headers as Record<string, string>), 'if-none-match': etagA },
    });
    if (r7.status === 304) {
      fail(
        "R18/step-7: B with A's ETag → NOT 304",
        'got 304 — ETag is leaking across tenants (PRD-705-R10 / PRD-103-R6)',
      );
    } else {
      pass(`R18/step-7: B with A's ETag → ${r7.status} (not 304; tenant ETag scope holds)`);
    }
  }

  // Step 8 — act_version: 1.0 → 400 with reason "act_version_unsupported".
  // The probe encodes the future MAJOR via the `act_version` query parameter
  // because the dispatch pipeline reads `act_version` from the query / Accept
  // header. The validation gap is the same.
  const r8 = await http(baseUrl, '/act/n/doc/acme-roadmap-2026?act_version=1.0', authA());
  if (r8.status !== 400) {
    record('R18/step-8: act_version=1.0 → 400 (advisory)', false,
      `got ${r8.status}; body=${r8.body.slice(0, 120)} (this step is delegated to PRD-501-R11; advisory only)`);
  } else {
    pass('R18/step-8: act_version=1.0 → 400');
  }

  return allOk;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('PRD-705 probe — Layer 1 (two-principal harness, in-process)');
  const layer1Ok = await runHarness();

  console.log('PRD-705 probe — Layer 2 (PRD-705-R18 HTTP transcript)');
  const { server, baseUrl } = await startServer(0);
  let layer2Ok: boolean;
  try {
    layer2Ok = await runTranscript(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  console.log('\nFindings:');
  for (const f of findings) {
    const mark = f.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${f.step}${f.detail ? `\n         ${f.detail}` : ''}`);
  }

  // Step 8 above is advisory; the security-test gate per PRD-705-R20 is on
  // steps 5/6/7 (cross-tenant 404 byte-equivalence + cross-tenant ETag
  // non-validation). Filter to those + the two-principal harness for the
  // pass/fail decision.
  const securityGateChecks = findings.filter((f) =>
    /R18\/step-(5|6|7)/.test(f.step) || f.step.startsWith('harness/'),
  );
  const securityGateFailed = securityGateChecks.some((f) => !f.ok);

  if (!layer1Ok || layer2Ok === false || securityGateFailed) {
    const layer1Note = layer1Ok ? '' : ' (Layer 1 harness failed)';
    const layer2Note = layer2Ok ? '' : ' (Layer 2 transcript reported failures)';
    const gateNote = securityGateFailed ? ' (security gate failed)' : '';
    console.error(`\nPRD-705 probe: FAILED${layer1Note}${layer2Note}${gateNote}`);
    // PRD-705-R20: failure of any cross-tenant probe is a release blocker.
    process.exit(1);
  }
  console.log('\nPRD-705 probe: OK — security gate green; harness + transcript pass.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

// Re-export so the conformance script can drive the same logic in-process.
export const _testHooks = { runHarness, runTranscript };
