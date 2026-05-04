/**
 * Public surface smoke tests for `@act-spec/component-angular`.
 */
import { describe, expect, it } from 'vitest';
import {
  ActCollectorService,
  ActContractService,
  ActSectionComponent,
  ActSectionDirective,
  ANGULAR_BINDING_CONTRACT_VERSION,
  ANGULAR_BINDING_NAME,
  AngularBindingError,
  COMPONENT_ANGULAR_PACKAGE_NAME,
  angularBinding,
  applyActSection,
  assertAngular17Plus,
  assertCollectorScopeIsComponentLocal,
  assertContractShape,
  capabilities,
  extractRoute,
  parseAngularMajor,
  pickStaticContract,
  validateContractShape,
} from './index.js';

describe('@act-spec/component-angular public surface', () => {
  it('exports the package marker', () => {
    expect(COMPONENT_ANGULAR_PACKAGE_NAME).toBe('@act-spec/component-angular');
  });

  it('exports the binding constants', () => {
    expect(ANGULAR_BINDING_NAME).toBe('@act-spec/component-angular');
    expect(ANGULAR_BINDING_CONTRACT_VERSION).toBe('0.1');
  });

  it('exports the binding object satisfying ActBinding', () => {
    expect(angularBinding.name).toBe('@act-spec/component-angular');
    expect(typeof angularBinding.extractRoute).toBe('function');
    expect(angularBinding.capabilities).toBe(capabilities);
  });

  it('exports the Angular-side declaration helpers', () => {
    expect(typeof ActCollectorService).toBe('function');
    expect(typeof ActContractService).toBe('function');
    expect(typeof ActSectionDirective).toBe('function');
    expect(typeof ActSectionComponent).toBe('function');
    expect(typeof applyActSection).toBe('function');
    expect(typeof pickStaticContract).toBe('function');
  });

  it('exports the extraction entry point', () => {
    expect(typeof extractRoute).toBe('function');
  });

  it('exports the capability matrix', () => {
    expect(capabilities['ssr-walk']).toBe(true);
  });

  it('exports the version + scope + contract-shape probes', () => {
    expect(typeof parseAngularMajor).toBe('function');
    expect(typeof assertAngular17Plus).toBe('function');
    expect(typeof assertCollectorScopeIsComponentLocal).toBe('function');
    expect(typeof validateContractShape).toBe('function');
    expect(typeof assertContractShape).toBe('function');
  });

  it('exports the binding-side build error subclass', () => {
    expect(typeof AngularBindingError).toBe('function');
  });
});
