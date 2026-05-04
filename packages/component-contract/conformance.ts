/**
 * Conformance harness for `@act-spec/component-contract` (PRD-300 framework).
 *
 * The framework package emits no nodes itself; per PRD-300's Wire format
 * section the binding leaves (PRD-301 React, PRD-302 Vue, PRD-303 Angular)
 * own envelope emission. This harness exercises the framework's contract
 * surface against the bundled positive / negative fixtures under
 * `test-fixtures/`. Each fixture asserts an invariant the framework
 * enforces (id grammar, placeholder shape, variant ID composition,
 * capability dispatch). Exits non-zero on any violation.
 *
 * Invoked by `pnpm -F @act-spec/component-contract conformance`. The G4
 * gate runs this alongside the unit suite.
 */
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregatePage,
  buildPlaceholder,
  chooseExtractionMode,
  composeVariantId,
  detectIdCollisions,
  gateContractVersion,
  redactSecrets,
  resolveVariantKeys,
  validateContractId,
  type BindingCapabilities,
} from './src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, 'test-fixtures');

interface FixtureCheck {
  /** Display name. */
  name: string;
  /** Run; throw on failure. */
  run: () => void;
}

function loadJson<T>(rel: string): T {
  const file = path.join(fixtureRoot, rel);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

interface PositiveFixture {
  id: string;
  /** What the fixture exercises (R-id list). */
  requirements: string[];
  /** Free-form input map; per-fixture handler reads what it needs. */
  input: Record<string, unknown>;
  /** Expected output the framework MUST produce. */
  expected: Record<string, unknown>;
}

interface NegativeFixture {
  id: string;
  requirements: string[];
  input: Record<string, unknown>;
  /** Substring expected to appear in the thrown error message. */
  expectedErrorSubstring: string;
}

const checks: FixtureCheck[] = [];

// Register one check per positive fixture.
for (const file of readdirSync(path.join(fixtureRoot, 'positive')).sort()) {
  if (!file.endsWith('.json')) continue;
  const fix = loadJson<PositiveFixture>(`positive/${file}`);
  checks.push({
    name: `positive/${file} [${fix.requirements.join(', ')}]`,
    run: () => runPositive(fix),
  });
}
for (const file of readdirSync(path.join(fixtureRoot, 'negative')).sort()) {
  if (!file.endsWith('.json')) continue;
  const fix = loadJson<NegativeFixture>(`negative/${file}`);
  checks.push({
    name: `negative/${file} [${fix.requirements.join(', ')}]`,
    run: () => runNegative(fix),
  });
}

function runPositive(fix: PositiveFixture): void {
  switch (fix.id) {
    case 'placeholder-shape': {
      const block = buildPlaceholder({
        error: fix.input['error'] as string,
        component: fix.input['component'] as string | undefined,
      });
      assertEqual(block, fix.expected, 'placeholder block shape');
      return;
    }
    case 'variant-id-composition': {
      const id = composeVariantId(
        fix.input['baseId'] as string,
        fix.input['key'] as string,
      );
      assertEqual({ id }, fix.expected, 'variant ID composition');
      return;
    }
    case 'capability-dispatch-rsc-ssr': {
      const mode = chooseExtractionMode(fix.input['caps'] as BindingCapabilities);
      assertEqual({ mode }, fix.expected, 'capability dispatch (RSC+SSR)');
      return;
    }
    case 'capability-dispatch-headless': {
      const mode = chooseExtractionMode(fix.input['caps'] as BindingCapabilities);
      assertEqual({ mode }, fix.expected, 'capability dispatch (headless-only)');
      return;
    }
    case 'secret-redaction': {
      const out = redactSecrets(fix.input['raw'] as string);
      assertEqual({ out }, fix.expected, 'secret redaction');
      return;
    }
    case 'variant-cap-allows-64': {
      const keys = Array.from({ length: 64 }, (_, i) => `k${String(i)}`);
      const resolved = resolveVariantKeys(keys, () => []);
      assertEqual({ length: resolved.length }, fix.expected, '64-key matrix accepted');
      return;
    }
    default:
      throw new Error(`unknown positive fixture id: ${fix.id}`);
  }
}

function runNegative(fix: NegativeFixture): void {
  let caught: Error | undefined;
  try {
    switch (fix.id) {
      case 'page-id-uppercase': {
        // Walk through aggregatePage so the BuildError surfaces.
        aggregatePage({
          page: {
            type: 'landing',
            id: fix.input['id'] as string,
            contract_version: '0.1',
            extract: () => ({ type: 'landing' }),
          },
          pageProps: {},
          ctx: {
            locale: undefined,
            variant: undefined,
            parentId: undefined,
            binding: '@act-spec/component-contract',
            warn: () => undefined,
          },
          descendants: [],
        });
        break;
      }
      case 'page-id-collision': {
        detectIdCollisions(fix.input['drafts'] as Array<{ id: string; routeId?: string }>);
        break;
      }
      case 'variant-cap-exceeded': {
        const keys = Array.from({ length: 65 }, (_, i) => `k${String(i)}`);
        resolveVariantKeys(keys, () => []);
        break;
      }
      case 'contract-version-major-exceeds': {
        gateContractVersion(
          fix.input['contractVersion'] as string,
          fix.input['bindingVersion'] as string,
        );
        break;
      }
      case 'invalid-id-grammar': {
        const reason = validateContractId(fix.input['id'] as string);
        if (reason !== null) throw new Error(reason);
        break;
      }
      default:
        throw new Error(`unknown negative fixture id: ${fix.id}`);
    }
  } catch (e) {
    caught = e as Error;
  }
  if (caught === undefined) {
    throw new Error(`expected error containing "${fix.expectedErrorSubstring}" but none thrown`);
  }
  if (!caught.message.includes(fix.expectedErrorSubstring)) {
    throw new Error(
      `error message did not include "${fix.expectedErrorSubstring}"; got: ${caught.message}`,
    );
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: actual !== expected\n  actual:   ${a}\n  expected: ${e}`);
  }
}

function main(): void {
  let pass = 0;
  let fail = 0;
  for (const c of checks) {
    try {
      c.run();
      console.log(`  PASS ${c.name}`);
      pass += 1;
    } catch (e) {
      console.error(`  FAIL ${c.name}`);
      console.error(`    ${(e as Error).message}`);
      fail += 1;
    }
  }
  console.log(
    `\nConformance summary: ${String(pass)} pass / ${String(fail)} fail across ${String(checks.length)} fixtures.`,
  );
  if (fail > 0) process.exit(1);
}

main();
