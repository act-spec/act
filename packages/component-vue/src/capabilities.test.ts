/**
 * PRD-302-R20 / R21 — capability + contract-version constants.
 *
 * Per A15 (capability-table truthfulness) the v0.1 binding sets only the
 * flags it actually implements; PRD-302-R20's published table values are
 * follow-up milestones.
 */
import { describe, expect, it } from 'vitest';
import {
  VUE_BINDING_CONTRACT_VERSION,
  VUE_BINDING_NAME,
  capabilities,
} from './capabilities.js';

describe('PRD-302-R20 capability matrix', () => {
  it('PRD-302-R20: ssr-walk is true (canonical path)', () => {
    expect(capabilities['ssr-walk']).toBe(true);
  });

  it('PRD-302-R20 + A15: static-ast is false in v0.1 (compiler-sfc scanner not shipped)', () => {
    expect(capabilities['static-ast']).toBe(false);
  });

  it('PRD-302-R20: headless-render is false (Vue SSR is canonical, not headless)', () => {
    expect(capabilities['headless-render']).toBe(false);
  });

  it('PRD-302-R20: rsc is false (no Vue 3 RSC equivalent in v0.1)', () => {
    expect(capabilities.rsc).toBe(false);
  });

  it('PRD-302-R20 + A15: streaming is false in v0.1 (renderToWebStream wiring deferred)', () => {
    expect(capabilities.streaming).toBe(false);
  });

  it('PRD-302-R20 + A15: suspense is false until streaming lands', () => {
    expect(capabilities.suspense).toBe(false);
  });

  it('PRD-302-R20: concurrent is true (per-call fresh app + provider scope)', () => {
    expect(capabilities.concurrent).toBe(true);
  });

  it('PRD-300-R28: every flag is a boolean (no undefined)', () => {
    for (const v of Object.values(capabilities)) {
      expect(typeof v).toBe('boolean');
    }
  });
});

describe('PRD-302-R21 contractVersion', () => {
  it('PRD-302-R21: contractVersion matches ^[0-9]+\\.[0-9]+$', () => {
    expect(VUE_BINDING_CONTRACT_VERSION).toMatch(/^[0-9]+\.[0-9]+$/);
  });

  it('PRD-302-R21: v0.1 binding publishes contractVersion "0.1"', () => {
    expect(VUE_BINDING_CONTRACT_VERSION).toBe('0.1');
  });
});

describe('PRD-302-R1 binding name', () => {
  it('PRD-302-R1: published name is "@act-spec/component-vue"', () => {
    expect(VUE_BINDING_NAME).toBe('@act-spec/component-vue');
  });
});
