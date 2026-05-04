/**
 * Public surface smoke tests for `@act-spec/component-react`.
 */
import { describe, expect, it } from 'vitest';
import {
  ActContractWrapper,
  ActProvider,
  ActSection,
  COMPONENT_REACT_PACKAGE_NAME,
  REACT_BINDING_CONTRACT_VERSION,
  REACT_BINDING_NAME,
  assertContractShape,
  assertHookNotInServerComponent,
  assertReact18Plus,
  capabilities,
  extractRoute,
  headlessCapabilities,
  parseReactMajor,
  reactBinding,
  useActContract,
  validateContractShape,
} from './index.js';

describe('@act-spec/component-react public surface', () => {
  it('exports the package marker', () => {
    expect(COMPONENT_REACT_PACKAGE_NAME).toBe('@act-spec/component-react');
  });

  it('exports the binding constants', () => {
    expect(REACT_BINDING_NAME).toBe('@act-spec/component-react');
    expect(REACT_BINDING_CONTRACT_VERSION).toBe('0.1');
  });

  it('exports the binding object satisfying ActBinding', () => {
    expect(reactBinding.name).toBe('@act-spec/component-react');
    expect(typeof reactBinding.extractRoute).toBe('function');
    expect(reactBinding.capabilities).toBe(capabilities);
  });

  it('exports the React-side declaration helpers', () => {
    expect(typeof useActContract).toBe('function');
    expect(typeof ActProvider).toBe('function');
    expect(typeof ActContractWrapper).toBe('function');
    expect(typeof ActSection).toBe('function');
  });

  it('exports the extraction entry point', () => {
    expect(typeof extractRoute).toBe('function');
  });

  it('exports the capability matrices', () => {
    expect(capabilities['ssr-walk']).toBe(true);
    expect(headlessCapabilities['headless-render']).toBe(true);
  });

  it('exports the version + RSC + contract-shape probes', () => {
    expect(typeof parseReactMajor).toBe('function');
    expect(typeof assertReact18Plus).toBe('function');
    expect(typeof assertHookNotInServerComponent).toBe('function');
    expect(typeof validateContractShape).toBe('function');
    expect(typeof assertContractShape).toBe('function');
  });
});
