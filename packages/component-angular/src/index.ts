/**
 * `@act-spec/component-angular` — PRD-303 Angular binding for the ACT
 * v0.1 component contract (PRD-300).
 *
 * Public surface for generators (PRD-409 standalone CLI in v0.1; future
 * Angular generator in v0.2 per PRD-303 Goal 9) and end-user authors
 * who declare component contracts via Angular idioms.
 */

// PRD-303-R1 — package marker.
export const COMPONENT_ANGULAR_PACKAGE_NAME = '@act-spec/component-angular' as const;

// PRD-303-R20 / R21 — capability + contract-version constants.
export {
  ANGULAR_BINDING_CONTRACT_VERSION,
  ANGULAR_BINDING_NAME,
  capabilities,
} from './capabilities.js';

// PRD-303-R2 — Angular 17+ floor probes (exported for generators / tests).
export { assertAngular17Plus, parseAngularMajor } from './version-gate.js';

// PRD-303-R4 / R5 / R7 / R8 / R10 / R11 / R16 — collector + service +
// directive lifecycle helpers.
export {
  ActCollectorService,
  ActContractService,
  _resetFallbackSentinel,
  applyActSection,
  assertCollectorScopeIsComponentLocal,
  fallbackSentinel,
} from './collector.js';

// PRD-303-R5 — `*actSection` directive + `<act-section>` component
// base classes. Consumers extend these with `@Directive` / `@Component`
// decorators in their Angular app.
export {
  ActSectionComponent,
  ActSectionDirective,
} from './act-section.js';

// PRD-303-R3 / R6 — static-field desugar helper.
export { pickStaticContract } from './desugar.js';

// PRD-303 (mirrors PRD-301 Q1 resolution) — runtime contract validator.
export {
  assertContractShape,
  validateContractShape,
} from './validate-contract.js';

// Angular-side types — PRD-303 §"Wire format / interface definition".
export type {
  ActSectionInputs,
  AngularComponentWithAct,
  AngularExtractRouteInput,
  AngularType,
} from './types.js';

// PRD-303-R10 / R11 / R13 / R14 / R16 / R22 — main extraction entry point
// + SSR walker contract.
export { extractRoute, type SsrWalker, type SsrWalkerInput } from './extract.js';

// PRD-303-R1 / R20 / R21 / R22 / R23 — `ActBinding` export for generators.
export { angularBinding } from './binding.js';

// PRD-303-R2 / R7 / R11 / R22 — binding-side build error subclass.
export { AngularBindingError, type AngularBindingErrorCode } from './errors.js';

// Re-export framework types so consumers don't need to import them
// from `@act-spec/component-contract` separately when the only Angular
// touchpoint is the binding.
export type {
  ActBinding,
  ActContract,
  BindingCapabilities,
  ContractOutput,
  ExtractionContext,
  ExtractionMethod,
  NodeDraft,
  PageContract,
  VariantPolicy,
} from '@act-spec/component-contract';
export { BuildError } from '@act-spec/component-contract';
