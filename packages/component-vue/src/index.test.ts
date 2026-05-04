/**
 * Smoke tests for the public package surface.
 */
import { describe, expect, it } from 'vitest';
import * as pkg from './index.js';

describe('@act-spec/component-vue index', () => {
  it('exports the package marker', () => {
    expect(pkg.COMPONENT_VUE_PACKAGE_NAME).toBe('@act-spec/component-vue');
  });

  it('PRD-302-R1: exports vueBinding', () => {
    expect(pkg.vueBinding).toBeDefined();
    expect(pkg.vueBinding.name).toBe('@act-spec/component-vue');
  });

  it('PRD-302-R20: exports capabilities const', () => {
    expect(pkg.capabilities).toBeDefined();
    expect(pkg.capabilities['ssr-walk']).toBe(true);
  });

  it('PRD-302-R3 / R4 / R5: exports declaration helpers', () => {
    expect(typeof pkg.useActContract).toBe('function');
    expect(typeof pkg.useActStatic).toBe('function');
    expect(typeof pkg.defineActContract).toBe('function');
    expect(typeof pkg.installActProvider).toBe('function');
    expect(pkg.ActSection).toBeDefined();
  });

  it('PRD-302-R22: exports extractRoute', () => {
    expect(typeof pkg.extractRoute).toBe('function');
  });

  it('PRD-302-R2: exports version-gate helpers', () => {
    expect(typeof pkg.assertVue3Plus).toBe('function');
    expect(typeof pkg.parseVueMajor).toBe('function');
  });

  it('exports VueBindingError', () => {
    expect(pkg.VueBindingError).toBeDefined();
    expect(pkg.BuildError).toBeDefined();
  });
});
