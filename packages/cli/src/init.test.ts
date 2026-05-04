import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initProject } from './init.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'act-cli-init-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('PRD-409-R8 initProject', () => {
  it('PRD-409-R8: scaffolds the markdown template into an empty target', async () => {
    const result = await initProject('markdown', tmp);
    expect(result.written.map((p) => path.relative(tmp, p)).sort()).toEqual([
      '.gitignore',
      'act.config.ts',
      path.join('content', 'index.md'),
    ]);
    const cfgBody = await fs.readFile(path.join(tmp, 'act.config.ts'), 'utf8');
    expect(cfgBody).toContain('@act-spec/adapter-markdown');
  });

  it('PRD-409-R8: scaffolds the programmatic template', async () => {
    const result = await initProject('programmatic', tmp);
    expect(result.written.length).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(tmp, 'act.config.ts'), 'utf8')).toContain(
      '@act-spec/adapter-programmatic',
    );
  });

  it('PRD-409-R8: scaffolds the cms-contentful template with .env.example', async () => {
    await initProject('cms-contentful', tmp);
    const env = await fs.readFile(path.join(tmp, '.env.example'), 'utf8');
    expect(env).toContain('CONTENTFUL_TOKEN');
  });

  it('PRD-409-R8: refuses to scaffold when act.config.* already exists, no --force', async () => {
    await fs.writeFile(path.join(tmp, 'act.config.ts'), 'export default {};', 'utf8');
    await expect(initProject('markdown', tmp)).rejects.toThrow(/PRD-409-R8/);
  });

  it('PRD-409-R8: refuses when ANY template target file pre-exists, no --force', async () => {
    await fs.mkdir(path.join(tmp, 'content'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'content', 'index.md'), 'pre-existing', 'utf8');
    await expect(initProject('markdown', tmp)).rejects.toThrow(/PRD-409-R8/);
  });

  it('PRD-409-R8: refuses when a different act.config.* exists, even for a non-conflicting template', async () => {
    await fs.writeFile(path.join(tmp, 'act.config.json'), '{}', 'utf8');
    await expect(initProject('programmatic', tmp)).rejects.toThrow(/PRD-409-R8/);
  });

  it('PRD-409-R8: --force overwrites the conflicting files', async () => {
    await fs.writeFile(path.join(tmp, 'act.config.ts'), '// stale', 'utf8');
    const result = await initProject('markdown', tmp, { force: true });
    expect(result.written.length).toBeGreaterThan(0);
    const cfg = await fs.readFile(path.join(tmp, 'act.config.ts'), 'utf8');
    expect(cfg).not.toContain('stale');
  });

  it('PRD-409-R8: rejects unknown templates', async () => {
    await expect(initProject('hugo' as never, tmp)).rejects.toThrow(/PRD-409-R8/);
  });
});
