/**
 * PRD-301-R20 / R21 — capability matrix + contract version pinning.
 */
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_KEYS,
  assertCapabilitiesShape,
} from '@act-spec/component-contract';
import {
  REACT_BINDING_CONTRACT_VERSION,
  REACT_BINDING_NAME,
  capabilities,
  headlessCapabilities,
} from './capabilities.js';

describe('PRD-301-R20 capability declaration', () => {
  it('PRD-301-R20: exports a complete BindingCapabilities object', () => {
    expect(() => {
      assertCapabilitiesShape(capabilities);
    }).not.toThrow();
    for (const k of CAPABILITY_KEYS) {
      expect(typeof capabilities[k]).toBe('boolean');
    }
  });

  it('PRD-301-R20: pins ssr-walk=true (canonical mode)', () => {
    expect(capabilities['ssr-walk']).toBe(true);
  });

  it('PRD-301-R20 / PRD-300-R28 / A15: pins static-ast=false in v0.1 (Babel/SWC scanner not yet shipped — flag set truthfully)', () => {
    expect(capabilities['static-ast']).toBe(false);
  });

  it('PRD-301-R20: pins headless-render=false by default (opt-in via sub-export)', () => {
    expect(capabilities['headless-render']).toBe(false);
  });

  it('PRD-301-R20: pins rsc=true (server-tree-only walk per PRD-300-R30)', () => {
    expect(capabilities.rsc).toBe(true);
  });

  it('PRD-301-R20 / PRD-300-R28 / A15: pins streaming=false in v0.1 (renderToString is sync; onAllReady wiring is a follow-up milestone)', () => {
    expect(capabilities.streaming).toBe(false);
  });

  it('PRD-301-R20 / PRD-300-R28 / A15: pins suspense=false in v0.1 (depends on streaming path)', () => {
    expect(capabilities.suspense).toBe(false);
  });

  it('PRD-301-R20: pins concurrent=true', () => {
    expect(capabilities.concurrent).toBe(true);
  });

  it('PRD-301-R20 / R26: headlessCapabilities flips headless-render on without other drift', () => {
    expect(headlessCapabilities['headless-render']).toBe(true);
    expect(headlessCapabilities['ssr-walk']).toBe(capabilities['ssr-walk']);
    expect(headlessCapabilities.rsc).toBe(capabilities.rsc);
  });
});

describe('PRD-301-R21 contract version', () => {
  it('PRD-301-R21: published contractVersion matches PRD-300-R26 grammar', () => {
    expect(REACT_BINDING_CONTRACT_VERSION).toBe('0.1');
    expect(REACT_BINDING_CONTRACT_VERSION).toMatch(/^[0-9]+\.[0-9]+$/);
  });

  it('PRD-301-R1: package name pinned', () => {
    expect(REACT_BINDING_NAME).toBe('@act-spec/component-react');
  });
});
