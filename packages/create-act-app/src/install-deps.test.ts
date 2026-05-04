import { describe, expect, it } from 'vitest';

import { buildCommand, detectPackageManager, installCommand } from './install-deps.js';

describe('detectPackageManager', () => {
  it('detects pnpm from a typical user-agent', () => {
    expect(detectPackageManager('pnpm/9.12.3 npm/? node/v20.18.0 darwin x64')).toBe('pnpm');
  });

  it('detects yarn', () => {
    expect(detectPackageManager('yarn/1.22.22 npm/? node/v20.18.0 darwin x64')).toBe('yarn');
  });

  it('detects bun', () => {
    expect(detectPackageManager('bun/1.1.31 npm/? node/v20.18.0 darwin x64')).toBe('bun');
  });

  it('detects npm', () => {
    expect(detectPackageManager('npm/10.9.0 node/v20.18.0 darwin x64')).toBe('npm');
  });

  it('falls back to npm when user-agent is empty or unrecognized', () => {
    // NB: passing `undefined` lets the default kick in, which reads the
    // ambient env (pnpm during test) — so we test only the explicit forms
    // that the runtime detection path exercises when the env var is absent.
    expect(detectPackageManager('')).toBe('npm');
    expect(detectPackageManager('weirdpkg/1.0.0')).toBe('npm');
  });
});

describe('command helpers', () => {
  it('produces the expected install command per pm', () => {
    expect(installCommand('npm')).toBe('npm install');
    expect(installCommand('pnpm')).toBe('pnpm install');
    expect(installCommand('yarn')).toBe('yarn');
    expect(installCommand('bun')).toBe('bun install');
  });

  it('produces the expected build command per pm', () => {
    expect(buildCommand('npm')).toBe('npm run build');
    expect(buildCommand('pnpm')).toBe('pnpm run build');
    expect(buildCommand('yarn')).toBe('yarn build');
    expect(buildCommand('bun')).toBe('bun run build');
  });
});
