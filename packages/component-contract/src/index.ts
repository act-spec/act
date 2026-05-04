/**
 * @act-spec/component-contract — PRD-300 framework.
 *
 * Public surface for leaf bindings (PRD-301 React, PRD-302 Vue, PRD-303
 * Angular). Every export cites a PRD-300-R{n} requirement and is
 * exercised by at least one test under `src/**\/*.test.ts`.
 *
 * Framework package: emits no nodes itself. Bindings compose these
 * helpers (desugaring, aggregation, variant replay, placeholder, version
 * gate, capability dispatch) into framework-specific glue.
 */
export const COMPONENT_CONTRACT_PACKAGE_NAME = '@act-spec/component-contract' as const;

// Types — PRD-300-R2, R7, R14, R20, R26, R28.
export type {
  ActBinding,
  ActContract,
  BindingCapabilities,
  ContractOutput,
  ExtractRouteInput,
  ExtractionContext,
  ExtractionMethod,
  ExtractionMode,
  NodeDraft,
  NodeMetadata,
  PageContract,
  VariantPolicy,
} from './types.js';
export { COMPONENT_CONTRACT_FRAMEWORK_VERSION } from './types.js';

// Errors — PRD-300 build-time failure surface.
export { BuildError, type BuildErrorCode } from './errors.js';

// ID grammar — PRD-300-R5 / R10 (delegates to PRD-100-R10 / R11).
export {
  ID_BYTE_CAP,
  ID_GRAMMAR_RE,
  isValidIdGrammar,
  isWithinIdByteCap,
  validateContractId,
} from './id.js';

// Placeholder + secret redaction — PRD-300-R22 / R32 / R23.
export {
  ERROR_MESSAGE_CAP,
  buildPlaceholder,
  redactSecrets,
  stampPartial,
  type BuildPlaceholderInput,
} from './placeholder.js';

// Desugaring — PRD-300-R1 / R3 / R4 (gap D1).
export {
  DECORATOR_KEY,
  attachDecoratorContract,
  createHookRegistry,
  fromDecorator,
  fromStaticField,
  type HookRegistry,
} from './desugar.js';

// Extraction — PRD-300-R7 / R20 / R21 / R22 / R29.
export {
  rejectAuthorOverride,
  safeExtract,
  stampMetadata,
  validateBlockShape,
} from './extract.js';

// Aggregation — PRD-300-R9 / R10 / R11 / R12 / R13 / R24.
export {
  aggregatePage,
  detectIdCollisions,
  type AggregatePageInput,
  type DescendantContribution,
} from './aggregate.js';

// Variants — PRD-300-R14 / R15 / R16 / R17 / R18 / R19.
export {
  VARIANT_CAP_PER_PAGE,
  applyVariantMetadata,
  composeVariantId,
  replayVariants,
  resolveVariantKeys,
  type ReplayVariantsInput,
  type VariantSource,
} from './variants.js';

// Capabilities — PRD-300-R28 / R29 / R30 / R31.
export {
  CAPABILITY_KEYS,
  assertCapabilitiesShape,
  chooseExtractionMode,
  methodForMode,
} from './capabilities.js';

// Contract version — PRD-300-R26 / R27.
export {
  gateContractVersion,
  parseContractVersion,
  type ParsedVersion,
} from './contract-version.js';
