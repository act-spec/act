import { describe, expect, it } from 'vitest';

import { getTemplateFiles, isInitTemplate } from './templates.js';

describe('PRD-409-R8 init templates', () => {
  it('PRD-409-R8 markdown template: writes act.config.ts, content/index.md, .gitignore', () => {
    const files = getTemplateFiles('markdown');
    const paths = files.map((f) => f.relPath).sort();
    expect(paths).toEqual(['.gitignore', 'act.config.ts', 'content/index.md']);
  });

  it('PRD-409-R8 markdown template: act.config.ts wires PRD-201 markdown adapter against `content`', () => {
    const cfg = getTemplateFiles('markdown').find((f) => f.relPath === 'act.config.ts');
    expect(cfg).toBeDefined();
    expect(cfg!.contents).toContain('@act-spec/adapter-markdown');
    expect(cfg!.contents).toContain("sourceDir: 'content'");
  });

  it('PRD-409-R8 programmatic template: writes act.config.ts and .gitignore (no content/)', () => {
    const files = getTemplateFiles('programmatic');
    const paths = files.map((f) => f.relPath).sort();
    expect(paths).toEqual(['.gitignore', 'act.config.ts']);
    expect(paths).not.toContain('content/index.md');
  });

  it('PRD-409-R8 programmatic template: act.config.ts wires PRD-208 programmatic-adapter', () => {
    const cfg = getTemplateFiles('programmatic').find((f) => f.relPath === 'act.config.ts');
    expect(cfg!.contents).toContain('@act-spec/adapter-programmatic');
  });

  it('PRD-409-R8 cms-contentful template: writes act.config.ts, .env.example, .gitignore', () => {
    const files = getTemplateFiles('cms-contentful');
    const paths = files.map((f) => f.relPath).sort();
    expect(paths).toEqual(['.env.example', '.gitignore', 'act.config.ts']);
  });

  it('PRD-409-R8 cms-contentful template: .env.example documents CONTENTFUL_SPACE / CONTENTFUL_TOKEN', () => {
    const env = getTemplateFiles('cms-contentful').find((f) => f.relPath === '.env.example');
    expect(env!.contents).toContain('CONTENTFUL_SPACE');
    expect(env!.contents).toContain('CONTENTFUL_TOKEN');
  });

  it('PRD-409-R8 cms-contentful template: .gitignore excludes .env (security)', () => {
    const gi = getTemplateFiles('cms-contentful').find((f) => f.relPath === '.gitignore');
    expect(gi!.contents).toMatch(/^\.env$/m);
  });

  it('PRD-409-R8 isInitTemplate: accepts the three named templates only', () => {
    expect(isInitTemplate('markdown')).toBe(true);
    expect(isInitTemplate('programmatic')).toBe(true);
    expect(isInitTemplate('cms-contentful')).toBe(true);
    expect(isInitTemplate('hugo')).toBe(false);
    expect(isInitTemplate('')).toBe(false);
    expect(isInitTemplate(undefined)).toBe(false);
  });
});
