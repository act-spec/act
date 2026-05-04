import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyTemplate, DestinationNotEmptyError, DEFAULT_EXCLUDED_NAMES } from './copy-template.js';

describe('copyTemplate', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'create-act-app-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  async function makeSrc(): Promise<string> {
    const src = path.join(tmpRoot, 'src');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'package.json'), '{"name":"x"}\n');
    await fs.mkdir(path.join(src, 'sub'), { recursive: true });
    await fs.writeFile(path.join(src, 'sub', 'a.ts'), 'export {};\n');
    // Should be skipped:
    await fs.mkdir(path.join(src, 'node_modules', 'foo'), { recursive: true });
    await fs.writeFile(path.join(src, 'node_modules', 'foo', 'index.js'), 'noop');
    await fs.mkdir(path.join(src, 'dist'), { recursive: true });
    await fs.writeFile(path.join(src, 'dist', 'out.js'), 'noop');
    await fs.writeFile(path.join(src, '.act-build-report.json'), '{}');
    return src;
  }

  it('copies non-excluded files and reports the count', async () => {
    const src = await makeSrc();
    const dest = path.join(tmpRoot, 'dest');
    const { filesCopied } = await copyTemplate(src, dest);
    expect(filesCopied).toBe(2);
    await expect(fs.readFile(path.join(dest, 'package.json'), 'utf8')).resolves.toContain('"name"');
    await expect(fs.readFile(path.join(dest, 'sub', 'a.ts'), 'utf8')).resolves.toContain('export');
  });

  it('skips every name in DEFAULT_EXCLUDED_NAMES', async () => {
    const src = await makeSrc();
    const dest = path.join(tmpRoot, 'dest');
    await copyTemplate(src, dest);
    for (const name of ['node_modules', 'dist', '.act-build-report.json']) {
      expect(DEFAULT_EXCLUDED_NAMES.has(name)).toBe(true);
      await expect(fs.access(path.join(dest, name))).rejects.toThrow();
    }
  });

  it('refuses to write into a non-empty directory by default', async () => {
    const src = await makeSrc();
    const dest = path.join(tmpRoot, 'dest');
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, 'existing.txt'), 'hi');
    await expect(copyTemplate(src, dest)).rejects.toBeInstanceOf(DestinationNotEmptyError);
  });

  it('allows writing into a non-empty directory when refuseIfNonEmpty=false', async () => {
    const src = await makeSrc();
    const dest = path.join(tmpRoot, 'dest');
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, 'existing.txt'), 'hi');
    const { filesCopied } = await copyTemplate(src, dest, { refuseIfNonEmpty: false });
    expect(filesCopied).toBe(2);
    // Pre-existing file is preserved.
    await expect(fs.readFile(path.join(dest, 'existing.txt'), 'utf8')).resolves.toBe('hi');
  });

  it('throws when source is missing', async () => {
    await expect(
      copyTemplate(path.join(tmpRoot, 'missing'), path.join(tmpRoot, 'dest')),
    ).rejects.toThrow(/template source missing/);
  });
});
