import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { hasWorkspaceRefs, type PackageJsonLike } from './rewrite-package-json.js';
import type { Sink, TemplateManifest } from './types.js';

interface CapturedSink {
  stdout: string;
  stderr: string;
  sink: Sink;
}

function captureSink(): CapturedSink {
  const captured = { stdout: '', stderr: '' };
  const sink: Sink = {
    stdout: (s) => {
      captured.stdout += s;
    },
    stderr: (s) => {
      captured.stderr += s;
    },
  };
  return Object.assign(captured, { sink });
}

describe('runCli', () => {
  let tmpRoot: string;
  let templatesDir: string;
  let manifest: TemplateManifest;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'create-act-app-cli-'));
    templatesDir = path.join(tmpRoot, 'templates');
    await fs.mkdir(templatesDir, { recursive: true });

    // Synthesize one template that mirrors the shape of a real example.
    const t1 = path.join(templatesDir, 'astro-docs');
    await fs.mkdir(t1, { recursive: true });
    await fs.writeFile(
      path.join(t1, 'package.json'),
      JSON.stringify(
        {
          name: '@act-spec/example-astro-docs',
          version: '0.0.0',
          private: true,
          dependencies: {
            astro: '^4.16.19',
            '@act-spec/plugin-astro': 'workspace:*',
          },
          devDependencies: {
            '@act-spec/validator': 'workspace:*',
          },
          repository: {
            type: 'git',
            url: 'git+https://github.com/act-spec/act.git',
            directory: 'examples/astro-docs',
          },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(path.join(t1, 'README.md'), '# astro-docs\n');
    await fs.mkdir(path.join(t1, 'src'), { recursive: true });
    await fs.writeFile(path.join(t1, 'src', 'index.astro'), '---\n---\n<h1>Hi</h1>\n');

    manifest = {
      templates: [{ name: 'astro-docs', description: 'Astro docs' }],
    };
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('prints help and exits 0 on --help', async () => {
    const cap = captureSink();
    const code = await runCli(['--help'], cap.sink, { templatesDir, manifest });
    expect(code).toBe(0);
    expect(cap.stdout).toContain('USAGE');
    expect(cap.stdout).toContain('npm create act-app@latest');
  });

  it('prints version and exits 0 on --version', async () => {
    const cap = captureSink();
    const code = await runCli(['--version'], cap.sink, { templatesDir, manifest });
    expect(code).toBe(0);
    expect(cap.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('returns 2 on bad argv', async () => {
    const cap = captureSink();
    const code = await runCli(['--nope'], cap.sink, { templatesDir, manifest });
    expect(code).toBe(2);
    expect(cap.stderr).toContain('create-act-app:');
  });

  it('returns 1 for an unknown template', async () => {
    const cap = captureSink();
    const code = await runCli(['nope'], cap.sink, {
      cwd: tmpRoot,
      templatesDir,
      manifest,
    });
    expect(code).toBe(1);
    expect(cap.stderr).toContain('unknown template');
  });

  it('rejects an invalid project name', async () => {
    const cap = captureSink();
    const code = await runCli(['astro-docs', '--name', 'Bad Name With Spaces'], cap.sink, {
      cwd: tmpRoot,
      templatesDir,
      manifest,
    });
    expect(code).toBe(2);
    expect(cap.stderr).toContain('invalid project name');
  });

  it('rejects an invalid --package-manager', async () => {
    const cap = captureSink();
    const code = await runCli(['astro-docs', '--package-manager', 'rush'], cap.sink, {
      cwd: tmpRoot,
      templatesDir,
      manifest,
    });
    expect(code).toBe(2);
    expect(cap.stderr).toContain('--package-manager');
  });

  it('scaffolds a working project end-to-end', async () => {
    const cap = captureSink();
    const code = await runCli(['astro-docs', '--name', 'my-test-app'], cap.sink, {
      cwd: tmpRoot,
      templatesDir,
      manifest,
    });
    expect(code).toBe(0);

    const dest = path.join(tmpRoot, 'my-test-app');
    const pkgRaw = await fs.readFile(path.join(dest, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw) as PackageJsonLike;

    // Renamed.
    expect(pkg.name).toBe('my-test-app');
    // No `private`.
    expect('private' in pkg).toBe(false);
    // No workspace refs.
    expect(hasWorkspaceRefs(pkg)).toBe(false);
    // Dep version line.
    expect(pkg.dependencies?.['@act-spec/plugin-astro']).toBe('^0.2.0');
    // repository.directory stripped.
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/your-org/your-repo.git',
    });
    // Other files copied.
    await expect(fs.readFile(path.join(dest, 'README.md'), 'utf8')).resolves.toContain('astro-docs');
    await expect(
      fs.readFile(path.join(dest, 'src', 'index.astro'), 'utf8'),
    ).resolves.toContain('Hi');

    // Friendly stdout.
    expect(cap.stdout).toContain('Done.');
    expect(cap.stdout).toContain('cd my-test-app');
  });

  it('honors --target separately from --name', async () => {
    const cap = captureSink();
    const code = await runCli(
      ['astro-docs', '--name', 'my-test-app', '--target', 'sub/here'],
      cap.sink,
      { cwd: tmpRoot, templatesDir, manifest },
    );
    expect(code).toBe(0);
    const dest = path.join(tmpRoot, 'sub', 'here');
    const pkg = JSON.parse(await fs.readFile(path.join(dest, 'package.json'), 'utf8')) as PackageJsonLike;
    expect(pkg.name).toBe('my-test-app');
  });

  it('refuses to scaffold into a non-empty dir without --force', async () => {
    const dest = path.join(tmpRoot, 'astro-docs');
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, 'existing.txt'), 'hi');

    const cap = captureSink();
    const code = await runCli(['astro-docs'], cap.sink, {
      cwd: tmpRoot,
      templatesDir,
      manifest,
    });
    expect(code).toBe(1);
    expect(cap.stderr).toMatch(/not empty|--force/);
  });

  it('allows --force into a non-empty dir', async () => {
    const dest = path.join(tmpRoot, 'astro-docs');
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, 'existing.txt'), 'hi');

    const cap = captureSink();
    const code = await runCli(['astro-docs', '--force'], cap.sink, {
      cwd: tmpRoot,
      templatesDir,
      manifest,
    });
    expect(code).toBe(0);
    await expect(fs.readFile(path.join(dest, 'existing.txt'), 'utf8')).resolves.toBe('hi');
    await expect(fs.readFile(path.join(dest, 'README.md'), 'utf8')).resolves.toContain('astro-docs');
  });

  it('reports a missing manifest cleanly', async () => {
    const cap = captureSink();
    const emptyDir = path.join(tmpRoot, 'no-manifest');
    await fs.mkdir(emptyDir, { recursive: true });
    const code = await runCli(['astro-docs'], cap.sink, {
      cwd: tmpRoot,
      templatesDir: emptyDir,
    });
    expect(code).toBe(1);
    expect(cap.stderr).toMatch(/manifest\.json missing/);
  });
});
