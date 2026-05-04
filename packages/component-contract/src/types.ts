/**
 * PRD-300 component-contract framework — public type surface.
 *
 * Every exported type cites the PRD-300-R{n} requirement it pins. Mirrors
 * PRD-300's §"Wire format / interface definition" so leaf bindings
 * (PRD-301 React, PRD-302 Vue, PRD-303 Angular) can declare against a
 * stable framework-agnostic shape per gap D1.
 */

/**
 * PRD-300-R7 — a successfully-extracted block that satisfies PRD-100-R28
 * (block discriminator) and the per-type schema in PRD-102. The framework
 * does NOT enumerate per-type field shapes; per-type validation is the
 * binding's responsibility before emission per PRD-300-R20.
 */
export interface ContractOutput {
  type: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * PRD-300-R7 — extraction context handed to every `extract` invocation.
 * Generators (PRD-400) populate this during traversal; bindings forward it
 * verbatim. Fields are READ-ONLY from the author's perspective.
 */
export interface ExtractionContext {
  /** PRD-104; undefined for non-i18n builds. */
  locale: string | undefined;
  /** PRD-300-R15; undefined for the canonical/default variant. */
  variant: string | undefined;
  /** PRD-300-R6; undefined outside a page contract. */
  parentId: string | undefined;
  /** Binding name (e.g., `"@act/react"`). PRD-300-R7. */
  binding: string;
  /** PRD-300-R7 — non-fatal warning channel attached to the current extraction. */
  warn: (message: string) => void;
}

/**
 * PRD-300-R14 — variant emission policy on a contract.
 * - `"default"` (or omitted): emit only the canonical render.
 * - `"all"`: bindings discover the variant key set themselves (e.g., from
 *   the framework's locale list or experiment registry).
 * - `string[]`: explicit closed list of variant keys.
 */
export type VariantPolicy = 'default' | 'all' | readonly string[];

/**
 * PRD-300-R2, R3 — the canonical contract object every declaration pattern
 * (static field / hook / decorator) MUST desugar into. The shape is the
 * single source of truth for per-framework bindings; binding-specific
 * decoration / registration helpers wrap this object.
 */
export interface ActContract<P = unknown> {
  /** Block type (PRD-102) for component/block-level; node type (PRD-100) for page-level. */
  type: string;
  /** REQUIRED on page-level contracts; OPTIONAL otherwise (PRD-300-R5/R6/R10). */
  id?: string;
  /** PRD-300-R2 — one-sentence summary; honored on page-level for `node.summary`. */
  summary?: string;
  /** PRD-300-R12 — cross-references emitted verbatim on the page node. */
  related?: ReadonlyArray<{ id: string; relation: string }>;
  /** PRD-300-R14–R16 — variant emission policy. */
  variants?: VariantPolicy;
  /** PRD-300-R26 — REQUIRED. MAJOR.MINOR per PRD-108-R2. */
  contract_version: string;
  /** PRD-300-R7 — synchronous in v0.1; Promise-shaped returns are placeholders. */
  extract: (props: P, ctx: ExtractionContext) => ContractOutput | ContractOutput[];
}

/**
 * PRD-300-R10 — page-level contracts MUST carry `id`. The TS shape is a
 * narrowing of `ActContract<P>` that bindings/generators use to enforce
 * the page-level distinction at the type layer.
 */
export interface PageContract<P = unknown> extends ActContract<P> {
  id: string;
}

/**
 * PRD-300-R28 — closed v0.1 capability matrix a binding publishes at its
 * package boundary. Generators (PRD-400) read it once at startup to
 * decide which extraction mode to dispatch.
 */
export interface BindingCapabilities {
  /** Walk a server-rendered tree. */
  'ssr-walk': boolean;
  /** Static AST scan via babel/SWC. */
  'static-ast': boolean;
  /** Headless render via Playwright / jsdom (PRD-300-R29). */
  'headless-render': boolean;
  /** React Server Components / framework-equivalent (PRD-300-R30). */
  rsc: boolean;
  /** Framework streaming (PRD-300-R31). */
  streaming: boolean;
  /** `<Suspense>` boundary support during extraction. */
  suspense: boolean;
  /** Concurrent extraction across routes (PRD-400 owns parallelism). */
  concurrent: boolean;
}

/**
 * PRD-300-R28 — extraction modes a generator can dispatch. The order
 * `chooseExtractionMode` prefers is documented at PRD-300-R28 + R29 +
 * R30 (RSC > SSR > static-AST > headless).
 */
export type ExtractionMode =
  | 'rsc-ssr'
  | 'ssr-walk'
  | 'static-ast'
  | 'headless-render';

/**
 * PRD-300-R29 — value of `metadata.extraction_method` stamped by the
 * binding on every emitted block. Distinct from `metadata.extracted_via`
 * (PRD-102-R21, owned by the spec) which always reads `"component-contract"`.
 */
export type ExtractionMethod = 'ssr-walk' | 'static-ast' | 'headless-render' | 'rsc-ssr';

/**
 * PRD-300-R20 — node draft a binding produces before the generator fills
 * `act_version`/`etag`. Field shape mirrors PRD-100-R21/R22 minus the
 * generator-owned envelope fields.
 */
export interface NodeDraft {
  id: string;
  type: string;
  title: string;
  summary: string;
  /** Already in render order per PRD-300-R9. */
  content: ContractOutput[];
  related?: ReadonlyArray<{ id: string; relation: string }>;
  parent?: string | null;
  metadata?: NodeMetadata;
  tokens?: {
    summary?: number;
    body?: number;
    abstract?: number;
  };
}

/** PRD-300-R18, R29 — open `metadata` shape with the variant + method fields pinned. */
export interface NodeMetadata {
  variant?: { base_id: string; key: string; source: string };
  extraction_method?: ExtractionMethod;
  [key: string]: unknown;
}

/**
 * PRD-300-R28 — every leaf binding (PRD-301/302/303) implements this.
 * The framework does not provide an implementation; it provides the
 * helpers (desugaring, aggregation, variant replay, placeholder, version
 * gate) the implementation composes with.
 */
export interface ActBinding {
  /** Stable name surfaced in `ExtractionContext.binding`. */
  readonly name: string;
  /** PRD-300-R28 — static; generators read once. */
  readonly capabilities: BindingCapabilities;
  /** PRD-300-R26 — the contract MAJOR.MINOR this binding implements. */
  readonly contractVersion: string;
  /**
   * PRD-300-R20 — walk a route, produce zero or more node drafts.
   * Implementation strategy depends on `capabilities`; the generator
   * picks the strategy via `chooseExtractionMode` (PRD-300-R28).
   */
  extractRoute(input: ExtractRouteInput): Promise<NodeDraft[]>;
}

/** Input to `ActBinding.extractRoute`. PRD-300-R8 — delivery-inert. */
export interface ExtractRouteInput {
  /** Page-level id per PRD-300-R10. */
  routeId: string;
  /** The route module (framework-specific shape). */
  module: unknown;
  /** Build-time props per PRD-300-R32 (no request-scoped data). */
  routeProps: unknown;
  locale: string | undefined;
  variant: string | undefined;
}

/** PRD-300-R28 — framework conformance fixture set marker. */
export const COMPONENT_CONTRACT_FRAMEWORK_VERSION = '0.1' as const;
