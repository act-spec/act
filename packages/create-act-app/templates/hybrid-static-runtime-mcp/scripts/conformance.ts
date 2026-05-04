/**
 * `pnpm conformance` — chained PRD-706 gate.
 *
 * Runs in sequence:
 *   1. `build-marketing.ts` — emit the static marketing tree + parent
 *      manifest (PRD-706-R3 / R7 / R8).
 *   2. `build-marketing.ts` again — assert byte-equality across two
 *      consecutive builds (PRD-706-R16 / PRD-103-R4).
 *   3. `validate.ts` — runtime-walk validator gate against the parent
 *      manifest + each leaf manifest (PRD-706-R19; per-mount Plus + Standard).
 *   4. `probe.ts` — two-principal probe + R10 transcript on the app mount
 *      (PRD-706-R10, PRD-705 inheritance).
 *   5. `probe-mcp.ts` — MCP enumeration probe (PRD-706-R20).
 *
 * Any failing step returns non-zero exit; the chain stops.
 */
/* eslint-disable no-console */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(here, '..');
const distRoot = path.resolve(exampleRoot, 'dist');

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

/**
 * Hash every file under a directory into a deterministic digest used to
 * compare builds for byte-equality (PRD-706-R16).
 */
async function hashDir(root: string): Promise<string> {
  const entries: string[] = [];
  async function walk(dir: string): Promise<void> {
    const items = await fs.readdir(dir, { withFileTypes: true });
    items.sort((a, b) => a.name.localeCompare(b.name));
    for (const item of items) {
      const abs = path.resolve(dir, item.name);
      if (item.isDirectory()) {
        await walk(abs);
      } else if (item.isFile()) {
        const buf = await fs.readFile(abs);
        const rel = path.relative(root, abs);
        entries.push(`${rel}\t${createHash('sha256').update(buf).digest('hex')}`);
      }
    }
  }
  await walk(root);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

async function main(): Promise<void> {
  console.log('=== PRD-706 conformance: build #1 (marketing static + parent manifest) ===');
  const b1 = await run('build-marketing.ts');
  if (b1 !== 0) {
    console.error(`build #1 exited ${b1}`);
    process.exit(b1);
  }
  const hash1 = await hashDir(distRoot);
  console.log(`  build #1 dist/ digest: ${hash1.slice(0, 16)}…`);

  console.log('\n=== PRD-706 conformance: build #2 (byte-equality check, PRD-706-R16) ===');
  const b2 = await run('build-marketing.ts');
  if (b2 !== 0) {
    console.error(`build #2 exited ${b2}`);
    process.exit(b2);
  }
  const hash2 = await hashDir(distRoot);
  console.log(`  build #2 dist/ digest: ${hash2.slice(0, 16)}…`);
  if (hash1 !== hash2) {
    console.error('FAIL: build is non-deterministic (PRD-706-R16 / PRD-103-R4 violated).');
    console.error(`  hash #1 = ${hash1}`);
    console.error(`  hash #2 = ${hash2}`);
    process.exit(1);
  }
  console.log('  PASS: dist/ byte-identical across two consecutive builds.');

  console.log('\n=== PRD-706 conformance: validator gate (parent + per-mount) ===');
  const v = await run('validate.ts');
  if (v !== 0) {
    console.error(`validator exited ${v}`);
    process.exit(v);
  }

  console.log('\n=== PRD-706 conformance: two-principal probe + R10 transcript (app mount) ===');
  const p = await run('probe.ts');
  if (p !== 0) {
    console.error(`probe exited ${p}`);
    process.exit(p);
  }

  console.log('\n=== PRD-706 conformance: MCP enumeration probe ===');
  const m = await run('probe-mcp.ts');
  if (m !== 0) {
    console.error(`MCP probe exited ${m}`);
    process.exit(m);
  }

  console.log('\n=== PRD-706 conformance: ALL GREEN ===');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
