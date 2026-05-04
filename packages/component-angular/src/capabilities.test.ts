/**
 * PRD-303-R20 — capability matrix declaration; PRD-303-R21 — contract version.
 *
 * Per A15 truthfulness posture (applied symmetrically to PRD-301-R20):
 * the binding's published matrix MUST match the v0.1 implementation
 * surface. The PRD-303-R20 published target table flips `static-ast`
 * to `true` once the @angular/compiler-cli scanner ships (MINOR per
 * PRD-108-R4(5)). Until then the matrix below is the truthful
 * declaration.
 */
import { describe, expect, it } from 'vitest';
import {
  ANGULAR_BINDING_CONTRACT_VERSION,
  ANGULAR_BINDING_NAME,
  capabilities,
} from './capabilities.js';

describe('PRD-303-R20 capability declaration', () => {
  it('PRD-303-R20: ssr-walk is true (canonical v0.1 mode)', () => {
    expect(capabilities['ssr-walk']).toBe(true);
  });

  it('PRD-303-R20 / A15: static-ast is false (scanner not yet shipped)', () => {
    expect(capabilities['static-ast']).toBe(false);
  });

  it('PRD-303-R20: headless-render is false (not shipped in v0.1)', () => {
    expect(capabilities['headless-render']).toBe(false);
  });

  it('PRD-303-R20: rsc is false (no first-class Angular RSC equivalent in v0.1)', () => {
    expect(capabilities.rsc).toBe(false);
  });

  it('PRD-303-R20: streaming is false (Angular SSR has no public streaming API in v0.1)', () => {
    expect(capabilities.streaming).toBe(false);
  });

  it('PRD-303-R20: suspense is false (no first-class equivalent in Angular in v0.1)', () => {
    expect(capabilities.suspense).toBe(false);
  });

  it('PRD-303-R20: concurrent is true (fresh ApplicationRef + EnvironmentInjector per render)', () => {
    expect(capabilities.concurrent).toBe(true);
  });
});

describe('PRD-303-R1 / R21 binding constants', () => {
  it('PRD-303-R1: binding name is `@act-spec/component-angular`', () => {
    expect(ANGULAR_BINDING_NAME).toBe('@act-spec/component-angular');
  });

  it('PRD-303-R21: contractVersion matches PRD-300-R26 grammar `^[0-9]+\\.[0-9]+$`', () => {
    expect(ANGULAR_BINDING_CONTRACT_VERSION).toMatch(/^[0-9]+\.[0-9]+$/);
    expect(ANGULAR_BINDING_CONTRACT_VERSION).toBe('0.1');
  });
});
