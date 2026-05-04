/**
 * `pnpm conformance` — chained gate.
 *
 * Runs the validator (`scripts/validate.ts`) and the security probe
 * (`scripts/probe.ts`) in sequence; either failure aborts with a non-zero
 * exit. Both scripts already exit non-zero on failure; the chain is via
 * child_process so each gets a clean process state for boot/shutdown.
 *
 * The package.json `conformance` script delegates to this file so consumers
 * can run `pnpm -F @act-spec/example-nextjs-saas-runtime conformance`.
 */
/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function run(script: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', path.join(here, script)],
      { stdio: 'inherit' },
    );
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  console.log('=== PRD-705 conformance: validator gate ===');
  const v = await run('validate.ts');
  if (v !== 0) {
    console.error(`validator exited ${v}`);
    process.exit(v);
  }
  console.log('\n=== PRD-705 conformance: two-principal probe + R18 transcript ===');
  const p = await run('probe.ts');
  if (p !== 0) {
    console.error(`probe exited ${p}`);
    process.exit(p);
  }
  console.log('\n=== PRD-705 conformance: ALL GREEN ===');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
