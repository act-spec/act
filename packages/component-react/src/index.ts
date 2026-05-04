/**
 * `@act-spec/component-react` — PRD-301 React binding for the ACT v0.1
 * component contract (PRD-300).
 *
 * Public surface for generators (PRD-401 Astro, PRD-404 Docusaurus,
 * PRD-405 Next.js, PRD-406 Remix, PRD-409 CLI) and end-user authors who
 * declare component contracts via React idioms.
 */

// PRD-301-R1 — package marker.
export const COMPONENT_REACT_PACKAGE_NAME = '@act-spec/component-react' as const;

// PRD-301-R20 / R21 — capability + contract-version constants.
export {
  REACT_BINDING_CONTRACT_VERSION,
  REACT_BINDING_NAME,
  capabilities,
  headlessCapabilities,
} from './capabilities.js';

// PRD-301-R2 — React 18+ floor probes (exported for generators / tests).
export { assertReact18Plus, parseReactMajor } from './version-gate.js';

// PRD-301-R12 — RSC walk guard.
export {
  assertHookNotInServerComponent,
  type RscModuleClassification,
} from './rsc-guard.js';

// PRD-301-R3 / R4 / R5 / R10 — declaration patterns + provider.
export {
  ActContractWrapper,
  ActProvider,
  ActSection,
  _ActProviderWithState,
  _resetFallbackSentinel,
  createCollectorState,
  fallbackSentinel,
  useActContract,
  useCollectorState,
  type CollectorState,
} from './provider.js';

// PRD-301 Q1 (resolved 2026-05-01) — runtime contract validator.
export {
  assertContractShape,
  validateContractShape,
} from './validate-contract.js';

// React-side types — PRD-301 §"React-specific declaration types".
export type {
  ActContractWrapperProps,
  ActProviderProps,
  ReactComponentWithAct,
  ReactExtractRouteInput,
} from './types.js';

// PRD-301-R10 / R11 / R13 / R14 / R16 / R22 — main extraction entry point.
export { extractRoute } from './extract.js';

// PRD-301-R1 / R20 / R21 / R22 / R23 — `ActBinding` export for generators.
export { reactBinding } from './binding.js';

// Re-export framework types so consumers don't need to import them
// from `@act-spec/component-contract` separately when the only React
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
