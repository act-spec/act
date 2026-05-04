import { describe, expect, it } from 'vitest';

import {
  hasWorkspaceRefs,
  isWorkspaceProtocol,
  rewritePackageJson,
  type PackageJsonLike,
} from './rewrite-package-json.js';

describe('isWorkspaceProtocol', () => {
  it('matches every workspace protocol form', () => {
    expect(isWorkspaceProtocol('workspace:*')).toBe(true);
    expect(isWorkspaceProtocol('workspace:^')).toBe(true);
    expect(isWorkspaceProtocol('workspace:~')).toBe(true);
    expect(isWorkspaceProtocol('workspace:1.2.3')).toBe(true);
  });

  it('rejects regular ranges', () => {
    expect(isWorkspaceProtocol('^1.0.0')).toBe(false);
    expect(isWorkspaceProtocol('1.0.0')).toBe(false);
    expect(isWorkspaceProtocol('npm:foo@1')).toBe(false);
  });
});

describe('rewritePackageJson', () => {
  const ORIGINAL: PackageJsonLike = {
    name: '@act-spec/example-astro-docs',
    version: '0.0.0',
    private: true,
    dependencies: {
      astro: '^4.16.19',
      '@act-spec/plugin-astro': 'workspace:*',
      '@act-spec/adapter-markdown': 'workspace:^',
    },
    devDependencies: {
      '@act-spec/validator': 'workspace:*',
      tsx: '^4.19.2',
    },
    repository: {
      type: 'git',
      url: 'git+https://github.com/act-spec/act.git',
      directory: 'examples/astro-docs',
    },
    pnpm: {
      executionEnv: { nodeVersion: '20' },
    },
  };

  it('replaces workspace refs with the default range and renames the project', () => {
    const out = rewritePackageJson(ORIGINAL, { projectName: 'my-docs' });
    expect(out.name).toBe('my-docs');
    expect(out.dependencies).toEqual({
      astro: '^4.16.19',
      '@act-spec/plugin-astro': '^0.2.0',
      '@act-spec/adapter-markdown': '^0.2.0',
    });
    expect(out.devDependencies).toEqual({
      '@act-spec/validator': '^0.2.0',
      tsx: '^4.19.2',
    });
    expect(hasWorkspaceRefs(out)).toBe(false);
  });

  it('honors a custom workspaceVersion override', () => {
    const out = rewritePackageJson(ORIGINAL, {
      projectName: 'my-docs',
      workspaceVersion: '0.2.0-rc.1',
    });
    expect(out.dependencies?.['@act-spec/plugin-astro']).toBe('0.2.0-rc.1');
  });

  it('drops `private`', () => {
    const out = rewritePackageJson(ORIGINAL, { projectName: 'my-docs' });
    expect('private' in out).toBe(false);
  });

  it('strips repository.directory and replaces act-spec/act repository.url with a placeholder', () => {
    const out = rewritePackageJson(ORIGINAL, { projectName: 'my-docs' });
    expect(out.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/your-org/your-repo.git',
    });
  });

  it('preserves a non-act-spec repository.url verbatim', () => {
    const out = rewritePackageJson(
      { ...ORIGINAL, repository: { type: 'git', url: 'git+https://github.com/me/mine.git' } },
      { projectName: 'my-docs' },
    );
    expect(out.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/me/mine.git',
    });
  });

  it('drops pnpm.executionEnv (and the empty pnpm block)', () => {
    const out = rewritePackageJson(ORIGINAL, { projectName: 'my-docs' });
    expect('pnpm' in out).toBe(false);
  });

  it('keeps unrelated pnpm keys', () => {
    const out = rewritePackageJson(
      { ...ORIGINAL, pnpm: { executionEnv: {}, overrides: { foo: '1.0.0' } } },
      { projectName: 'my-docs' },
    );
    expect(out.pnpm).toEqual({ overrides: { foo: '1.0.0' } });
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(ORIGINAL);
    rewritePackageJson(ORIGINAL, { projectName: 'my-docs' });
    expect(JSON.stringify(ORIGINAL)).toBe(before);
  });

  it('handles a string-form repository field', () => {
    const out = rewritePackageJson(
      { name: 'x', repository: 'github:act-spec/act' as unknown as string },
      { projectName: 'my' },
    );
    expect(out.repository).toBe('git+https://github.com/your-org/your-repo.git');
  });

  it('passes through unknown deps maps unchanged', () => {
    const out = rewritePackageJson(
      {
        name: 'x',
        peerDependencies: { 'eslint': '^9' },
        optionalDependencies: { fsevents: '^2' },
      },
      { projectName: 'y' },
    );
    expect(out.peerDependencies).toEqual({ eslint: '^9' });
    expect(out.optionalDependencies).toEqual({ fsevents: '^2' });
  });
});
