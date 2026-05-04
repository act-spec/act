import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';

let tmp: string;

function makeSink(): { stdout: string[]; stderr: string[]; sink: { stdout: (s: string) => void; stderr: (s: string) => void } } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    sink: {
      stdout: (s: string): void => {
        stdout.push(s);
      },
      stderr: (s: string): void => {
        stderr.push(s);
      },
    },
  };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'act-cli-cli-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeProgrammaticConfig(extra: Record<string, unknown> = {}): Promise<void> {
  // Self-contained .mjs config — programmatic adapter inlined so this test
  // does not depend on a TS loader to run the dispatcher.
  const body = `
import { defineProgrammaticAdapter } from '@act-spec/adapter-programmatic';
const adapter = defineProgrammaticAdapter({
  name: 'demo',
  enumerate: () => [{ id: 'home', title: 'Home' }],
  transform: (item) => ({
    act_version: '0.1',
    id: item.id,
    type: 'page',
    title: item.title,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    summary: 'A summary.',
    content: [{ type: 'markdown', text: 'Body.' }],
    tokens: { summary: 2, body: 1 },
  }),
  capabilities: { level: 'core' },
});
export default {
  conformanceTarget: 'core',
  outputDir: 'dist',
  adapters: [{ adapter, config: {}, actVersion: '0.1' }],
  site: { name: 'Tinybox' },
  ...${JSON.stringify(extra)},
};
`;
  await fs.writeFile(path.join(tmp, 'act.config.mjs'), body, 'utf8');
}

describe('PRD-409-R1 / R2 runCli top-level', () => {
  it('PRD-409-R2: --help prints usage', async () => {
    const { stdout, sink } = makeSink();
    const code = await runCli(['--help'], sink);
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('USAGE');
    expect(stdout.join('')).toContain('actree build');
    // §5.2.6 — flatten subcommand surfaced in top-level help.
    expect(stdout.join('')).toContain('actree flatten');
  });

  it('PRD-409-R2: no args prints help (zero exit)', async () => {
    const { stdout, sink } = makeSink();
    const code = await runCli([], sink);
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('USAGE');
  });

  it('PRD-409-R2: --version prints CLI + spec version', async () => {
    const { stdout, sink } = makeSink();
    const code = await runCli(['--version'], sink);
    expect(code).toBe(0);
    expect(stdout.join('')).toMatch(/act_version 0\.1/);
  });

  it('PRD-409-R2: unknown subcommand exits 2', async () => {
    const { sink, stderr } = makeSink();
    const code = await runCli(['frobnicate'], sink);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('unknown subcommand');
  });
});

describe('PRD-409-R2 / R4 / R7 / R12 actree build', () => {
  it('PRD-409-R5: errors with cited gap when no config file exists (exit 1)', async () => {
    const { sink, stderr } = makeSink();
    const code = await runCli(['build'], sink, { cwd: tmp });
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('PRD-409-R5');
  });

  it('PRD-409-R3: first log line announces framework-free posture', async () => {
    await writeProgrammaticConfig();
    const { sink, stderr } = makeSink();
    await runCli(['build'], sink, { cwd: tmp });
    expect(stderr.join('')).toContain('framework-free');
  });

  it('PRD-409-R4 / R7: actree build writes the static file set + exit 0', async () => {
    await writeProgrammaticConfig();
    const { sink } = makeSink();
    const code = await runCli(['build'], sink, { cwd: tmp });
    expect(code).toBe(0);
    const manifest = JSON.parse(
      await fs.readFile(path.join(tmp, 'dist', '.well-known', 'act.json'), 'utf8'),
    ) as { act_version: string; delivery: string };
    expect(manifest.act_version).toBe('0.1');
    expect(manifest.delivery).toBe('static');
  });

  it('PRD-409-R3: refuses configs declaring a `next` field (exit 1)', async () => {
    await writeProgrammaticConfig({ next: { foo: 1 } });
    const { sink, stderr } = makeSink();
    const code = await runCli(['build'], sink, { cwd: tmp });
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('PRD-409-R3');
    expect(stderr.join('')).toContain('PRD-405');
  });

  it('PRD-409-R9: --silent + --verbose exits 2 with usage error', async () => {
    await writeProgrammaticConfig();
    const { sink, stderr } = makeSink();
    const code = await runCli(['build', '--silent', '--verbose'], sink, { cwd: tmp });
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('PRD-409-R9');
  });

  it('PRD-409-R17: --profile overrides config conformanceTarget; warns on conflict', async () => {
    await writeProgrammaticConfig();
    const { sink, stderr } = makeSink();
    const code = await runCli(['build', '--profile', 'core'], sink, { cwd: tmp });
    expect(code).toBe(0);
    // Profile === existing target so no warning expected.
    expect(stderr.join('')).not.toContain('PRD-409-R17');
  });

  it('PRD-409-R17: rejects unknown profile', async () => {
    await writeProgrammaticConfig();
    const { sink, stderr } = makeSink();
    const code = await runCli(['build', '--profile', 'ultra'], sink, { cwd: tmp });
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('--profile must be');
  });

  it('PRD-409-R10: --timeout with malformed value exits 2', async () => {
    await writeProgrammaticConfig();
    const { sink, stderr } = makeSink();
    const code = await runCli(['build', '--timeout', 'wat'], sink, { cwd: tmp });
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('PRD-409-R10');
  });

  it('PRD-409-R11: refuses build when @act-spec/plugin-astro present + outputDir overlaps "dist"', async () => {
    await writeProgrammaticConfig();
    await fs.writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'op', dependencies: { '@act-spec/plugin-astro': 'workspace:*' } }),
      'utf8',
    );
    const { sink, stderr } = makeSink();
    const code = await runCli(['build'], sink, { cwd: tmp });
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('PRD-409-R11');
  });

  it('PRD-409-R11: --allow-output-conflict bypasses the check', async () => {
    await writeProgrammaticConfig();
    await fs.writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'op', dependencies: { '@act-spec/plugin-astro': 'workspace:*' } }),
      'utf8',
    );
    const { sink } = makeSink();
    const code = await runCli(['build', '--allow-output-conflict'], sink, { cwd: tmp });
    expect(code).toBe(0);
  });

  it('PRD-409-R13: --build-report path overrides default sidecar location', async () => {
    await writeProgrammaticConfig();
    const reportPath = path.join(tmp, 'custom.report.json');
    const { sink } = makeSink();
    const code = await runCli(['build', '--build-report', reportPath], sink, { cwd: tmp });
    expect(code).toBe(0);
    const stat = await fs.stat(reportPath);
    expect(stat.isFile()).toBe(true);
  });

  it('PRD-409-R9 --json emits NDJSON log lines', async () => {
    await writeProgrammaticConfig();
    const { stdout, sink } = makeSink();
    await runCli(['build', '--json'], sink, { cwd: tmp });
    const ndjson = stdout
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as { level?: string };
        } catch {
          return null;
        }
      })
      .filter((x): x is { level: string } => x !== null);
    expect(ndjson.length).toBeGreaterThan(0);
    expect(ndjson.every((e) => typeof e.level === 'string')).toBe(true);
  });
});

describe('PRD-409-R8 actree init', () => {
  it('PRD-409-R8: scaffolds the markdown template by default', async () => {
    const { sink } = makeSink();
    const code = await runCli(['init', '--target', tmp], sink, { cwd: tmp });
    expect(code).toBe(0);
    const cfg = await fs.readFile(path.join(tmp, 'act.config.ts'), 'utf8');
    expect(cfg).toContain('@act-spec/adapter-markdown');
  });

  it('PRD-409-R8: scaffolds programmatic when requested', async () => {
    const { sink } = makeSink();
    const code = await runCli(['init', 'programmatic', '--target', tmp], sink, { cwd: tmp });
    expect(code).toBe(0);
    expect(await fs.readFile(path.join(tmp, 'act.config.ts'), 'utf8')).toContain(
      '@act-spec/adapter-programmatic',
    );
  });

  it('PRD-409-R8: refuses unknown template (exit 2)', async () => {
    const { sink, stderr } = makeSink();
    const code = await runCli(['init', 'hugo', '--target', tmp], sink, { cwd: tmp });
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('unknown template');
  });

  it('PRD-409-R8: refuses to overwrite without --force', async () => {
    await fs.writeFile(path.join(tmp, 'act.config.ts'), '// stale', 'utf8');
    const { sink, stderr } = makeSink();
    const code = await runCli(['init', '--target', tmp], sink, { cwd: tmp });
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('PRD-409-R8');
  });

  it('PRD-409-R8: --force overwrites existing files', async () => {
    await fs.writeFile(path.join(tmp, 'act.config.ts'), '// stale', 'utf8');
    const { sink } = makeSink();
    const code = await runCli(['init', '--target', tmp, '--force'], sink, { cwd: tmp });
    expect(code).toBe(0);
  });
});

describe('§5.2.6 actree flatten', () => {
  it('§5.2.6: flatten --help prints subcommand usage', async () => {
    const { stdout, sink } = makeSink();
    const code = await runCli(['flatten', '--help'], sink);
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('actree flatten');
    expect(stdout.join('')).toContain('<url>');
  });

  it('§5.2.6: flatten without <url> exits 2', async () => {
    const { sink, stderr } = makeSink();
    const code = await runCli(['flatten'], sink);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('missing required <url>');
  });
});

describe('PRD-409-R15 actree validate', () => {
  it('PRD-409-R15: exits 2 when target missing', async () => {
    const { sink, stderr } = makeSink();
    const code = await runCli(['validate'], sink);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('PRD-409-R15');
  });

  it('PRD-409-R15: delegates to @act-spec/validator runCli (--help passthrough)', async () => {
    // The validator's CLI prints help when its own --help is supplied.
    const { sink } = makeSink();
    const code = await runCli(['validate', '--help'], sink);
    // We only assert delegation succeeded with a process exit code from the
    // validator (0 or 2 both indicate the import + dispatch worked).
    expect([0, 2]).toContain(code);
  });
});

describe('PRD-409-R2 / R9 build edge cases', () => {
  it('PRD-409-R2: build --help prints usage', async () => {
    const { stdout, sink } = makeSink();
    const code = await runCli(['build', '--help'], sink, { cwd: tmp });
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('USAGE');
  });

  it('PRD-409-R2: build rejects unknown flag with exit 2', async () => {
    const { sink, stderr } = makeSink();
    const code = await runCli(['build', '--bogus'], sink, { cwd: tmp });
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('actree build');
  });

  it('PRD-409-R17: --profile core when config has standard logs the override warning', async () => {
    await writeProgrammaticConfig({ conformanceTarget: 'standard' });
    const { sink, stderr } = makeSink();
    const code = await runCli(['build', '--profile', 'core', '--verbose'], sink, { cwd: tmp });
    // Build may still succeed since the adapter declares core-level capabilities.
    expect([0, 1]).toContain(code);
    expect(stderr.join('')).toContain('PRD-409-R17');
  });

  it('PRD-409-R8: init --help prints usage', async () => {
    const { stdout, sink } = makeSink();
    const code = await runCli(['init', '--help'], sink, { cwd: tmp });
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('USAGE');
  });

  it('PRD-409-R8: init rejects unknown flag with exit 2', async () => {
    const { sink } = makeSink();
    const code = await runCli(['init', '--bogus'], sink, { cwd: tmp });
    expect(code).toBe(2);
  });

  it('PRD-409-R4: build catches pipeline errors and exits 1 (e.g. adapter pinning failure)', async () => {
    // Config with an adapter declaring a mismatched act_version → adapter
    // pinning fails inside runPipeline → CLI exits 1 (not via timeout path).
    const body = `
import { defineProgrammaticAdapter } from '@act-spec/adapter-programmatic';
const adapter = defineProgrammaticAdapter({
  name: 'demo',
  enumerate: () => [{ id: 'home', title: 'Home' }],
  transform: (item) => ({
    act_version: '0.1', id: item.id, type: 'page', title: item.title,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    summary: 'A.', content: [{ type: 'markdown', text: 'b' }],
    tokens: { summary: 1, body: 1 },
  }),
  capabilities: { level: 'core' },
});
export default {
  conformanceTarget: 'core', outputDir: 'dist',
  adapters: [{ adapter, config: {}, actVersion: '0.2' }],
  site: { name: 'Test' },
};
`;
    await fs.writeFile(path.join(tmp, 'act.config.mjs'), body, 'utf8');
    const { sink, stderr } = makeSink();
    const code = await runCli(['build'], sink, { cwd: tmp });
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/PRD-200-R25|PRD-400-R29/);
  });

  it('PRD-409-R13: --build-report inside outputDir + --fail-on-warning exits 1', async () => {
    await writeProgrammaticConfig();
    const { sink } = makeSink();
    const inside = path.join(tmp, 'dist', '.act-build-report.json');
    const code = await runCli(['build', '--build-report', inside, '--fail-on-warning'], sink, {
      cwd: tmp,
    });
    expect(code).toBe(1);
  });
});
