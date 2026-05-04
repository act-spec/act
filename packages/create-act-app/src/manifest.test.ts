import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findTemplate, loadManifest, resolveTemplatesDir } from './manifest.js';

describe('manifest', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'create-act-app-mf-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('loads a well-formed manifest', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'manifest.json'),
      JSON.stringify({
        templates: [
          { name: 'astro-docs', description: 'Astro' },
          { name: 'eleventy-blog', description: 'Eleventy' },
        ],
      }),
    );
    const m = await loadManifest(tmpRoot);
    expect(m.templates.map((t) => t.name)).toEqual(['astro-docs', 'eleventy-blog']);
  });

  it('throws on missing manifest', async () => {
    await expect(loadManifest(tmpRoot)).rejects.toThrow(/manifest\.json missing/);
  });

  it('throws on malformed manifest', async () => {
    await fs.writeFile(path.join(tmpRoot, 'manifest.json'), '{"nope":1}');
    await expect(loadManifest(tmpRoot)).rejects.toThrow(/malformed/);
  });

  it('throws when an entry lacks a name', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'manifest.json'),
      JSON.stringify({ templates: [{ description: 'no name' }] }),
    );
    await expect(loadManifest(tmpRoot)).rejects.toThrow(/missing 'name'/);
  });

  it('coerces a missing description to empty string', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'manifest.json'),
      JSON.stringify({ templates: [{ name: 'x' }] }),
    );
    const m = await loadManifest(tmpRoot);
    expect(m.templates[0]).toEqual({ name: 'x', description: '' });
  });

  it('findTemplate returns by name and undefined for misses', () => {
    const m = { templates: [{ name: 'a', description: '' }] };
    expect(findTemplate(m, 'a')?.name).toBe('a');
    expect(findTemplate(m, 'b')).toBeUndefined();
  });

  it('resolveTemplatesDir returns an absolute path adjacent to dist/', () => {
    const p = resolveTemplatesDir();
    expect(path.isAbsolute(p)).toBe(true);
    expect(p.endsWith('templates')).toBe(true);
  });
});
