/**
 * PRD-303-R7 / R10 / R11 / R13 / R14 / R16 / R22 — `extractRoute` for Angular.
 *
 * Implements the SSR-walk extraction strategy:
 *   1. Validate the page-level id per PRD-303-R7 (PRD-100-R10/R11).
 *   2. Resolve the variant key set via `resolveVariantKeys` per PRD-303-R13.
 *   3. For each pass (canonical + per variant): create a fresh
 *      `ActCollectorService`, invoke the SSR walker (which under the
 *      hood wraps `@angular/platform-server.renderApplication` and
 *      awaits `ApplicationRef.isStable` per PRD-303-R10). The walker
 *      registers contracts on the collector via `register()`; after
 *      it resolves, the binding drains the collector and hands to
 *      `aggregatePage` per PRD-303-R10.
 *   4. Variant drafts get `metadata.variant` + `variant_of` related per
 *      PRD-300-R18 / R19 via `applyVariantMetadata`.
 *   5. Every emitted block carries `metadata.extracted_via` (R14) +
 *      `metadata.extraction_method: "ssr-walk"` (R15) per the framework
 *      `safeExtract`/`stampMetadata` chain.
 *
 * The `walker` parameter abstracts over the Angular SSR pipeline. The
 * binding's default walker (lazily imported from `./ssr-walker.js` so
 * the binding stays Angular-free at the type layer) wraps
 * `renderApplication` + the `ApplicationRef.isStable` first-`true` wait
 * per PRD-303-R10. Tests pass a mock walker so unit coverage does not
 * require booting Angular's runtime — see `extract.test.ts`.
 *
 * Per PRD-303-R23 the binding's test suite documents this as the
 * canonical integration pattern; PRD-409 (standalone CLI) supplies its
 * own walker once authored.
 */
import {
  aggregatePage,
  applyVariantMetadata,
  composeVariantId,
  detectIdCollisions,
  resolveVariantKeys,
  validateContractId,
  type DescendantContribution,
  type ExtractionContext,
  type NodeDraft,
  type PageContract,
} from '@act-spec/component-contract';
import {
  ANGULAR_BINDING_NAME,
  capabilities,
} from './capabilities.js';
import { AngularBindingError } from './errors.js';
import {
  ActCollectorService,
  _resetFallbackSentinel,
  fallbackSentinel,
} from './collector.js';
import { pickStaticContract } from './desugar.js';
import type { AngularExtractRouteInput } from './types.js';

/**
 * PRD-303-R10 / R22 — SSR walker contract. The default walker wraps
 * `@angular/platform-server.renderApplication`; the binding accepts a
 * pluggable walker so tests / generators can supply their own.
 *
 * The walker MUST:
 *  1. Bootstrap the supplied root component with the given collector
 *     wired into its providers as `ActCollectorService`;
 *  2. Render until `ApplicationRef.isStable` first emits `true`
 *     (PRD-303-R10);
 *  3. Resolve when the render is complete; reject only on render
 *     framework errors that the binding could not catch via the
 *     installed `ErrorHandler` provider.
 *
 * Component-level errors MUST be captured on `collector.recordError`
 * and the walker MUST resolve normally so descendants outside the
 * failing subtree can contribute (PRD-303-R16).
 */
export interface SsrWalker {
  (input: SsrWalkerInput): Promise<void>;
}

export interface SsrWalkerInput {
  /** Route bootstrap component (per PRD-303-R22). */
  module: unknown;
  /** Build-time-resolved props handed to the route component. */
  routeProps?: unknown;
  /** Per-render collector; the walker wires it into the app's providers. */
  collector: ActCollectorService;
  /** PRD-303-R15 — extraction context the binding hands to the walker. */
  context: { locale?: string | undefined; variant?: string | undefined };
}

interface RenderPassResult {
  collector: ActCollectorService;
  renderErrors: Array<{ error: Error; component?: string; location?: string }>;
  warnings: string[];
}

/**
 * PRD-303-R10 / R11 — perform one SSR-walk pass. Owns the collector
 * lifecycle: reset fallback sentinel, invoke the walker, drain.
 */
async function renderOnePass(
  walker: SsrWalker,
  module: unknown,
  routeProps: unknown,
  pageContract: PageContract,
  variant: string | undefined,
  locale: string | undefined,
): Promise<RenderPassResult> {
  _resetFallbackSentinel();
  const collector = new ActCollectorService();
  // PRD-303-R5 — the binding pre-seeds the page contract on the
  // collector when the route component carries a `static act` page-
  // level contract; the structural directive's `ngOnInit` would
  // otherwise set it and emit PRD-303-R11 on duplicate. We respect the
  // collector's setPageContract validation for nested-contract
  // detection by NOT pre-seeding here; the walker (or the route
  // component's `static act` field via the binding-side desugar) sets
  // it during render.
  if (variant !== undefined) collector.variant = variant;
  const warnings: string[] = [];
  const ctx: { locale?: string | undefined; variant?: string | undefined } = {};
  if (locale !== undefined) ctx.locale = locale;
  if (variant !== undefined) ctx.variant = variant;
  try {
    await walker({ module, routeProps, collector, context: ctx });
  } catch (e) {
    // PRD-303-R16 — walker-level failure (e.g., bootstrap throws
    // before the collector is wired). Capture as a warning and let
    // the binding emit a draft with whatever the collector has.
    const err = e instanceof Error ? e : new Error(String(e));
    warnings.push(`route walker threw: ${err.message}`);
    collector.recordError(err);
  }
  // Drain the fallback sentinel into the active collector — registrations
  // that fired outside an installed scope still surface as content (with
  // a placeholder downstream per PRD-303-R16).
  for (const entry of fallbackSentinel.collected) {
    collector.collected.push(entry);
  }
  if (fallbackSentinel.outsideScopeCount > 0) {
    warnings.push(
      `${String(fallbackSentinel.outsideScopeCount)} contract registration(s) fired outside ActCollectorService scope (PRD-303-R16)`,
    );
  }
  _resetFallbackSentinel();
  return { collector, renderErrors: collector.renderErrors, warnings };
}

function buildExtractionContext(
  pageContract: PageContract,
  locale: string | undefined,
  variant: string | undefined,
  warn: (msg: string) => void,
): ExtractionContext {
  return {
    locale,
    variant,
    parentId: pageContract.id,
    binding: ANGULAR_BINDING_NAME,
    warn,
  };
}

/**
 * PRD-303-R10 / R13 / R14 / R22 — one route's extraction. Returns the
 * canonical draft plus one draft per declared variant.
 *
 * The implementation strictly follows the framework helpers:
 *  - `resolveVariantKeys` (R13 + R17 variant cap)
 *  - `aggregatePage` (R10 + R14 — drains the collector in render order)
 *  - `applyVariantMetadata` (R13 wrapping R18/R19)
 *
 * Per PRD-303-R23 the binding does NOT supply `act_version` or `etag`;
 * the generator (PRD-409 in v0.1; future Angular generator in v0.2)
 * overlays those before serialising.
 */
export async function extractRoute(
  input: AngularExtractRouteInput,
  walker: SsrWalker,
): Promise<NodeDraft[]> {
  const { pageContract, module, locale } = input;

  // PRD-303-R7 — id grammar/byte-cap gate.
  const idError = validateContractId(pageContract.id);
  if (idError !== null) {
    throw new AngularBindingError('PRD-303-R7', idError);
  }

  // PRD-300-R26 — contract_version present on the page contract.
  if (typeof pageContract.contract_version !== 'string'
      || pageContract.contract_version.length === 0) {
    throw new AngularBindingError(
      'PRD-303-R7',
      `page contract "${pageContract.id}" missing contract_version`,
    );
  }

  const warnings: string[] = [];
  const warn = (m: string): void => {
    warnings.push(m);
  };

  // PRD-303-R13 — variant key resolution + 64-cap enforcement (rethrows
  // BuildError("PRD-300-R17") on violation).
  const variantKeys = resolveVariantKeys(pageContract.variants, () => []);

  const drafts: NodeDraft[] = [];

  // Canonical pass per PRD-300-R15 / PRD-102-R30.
  const canonical = await renderOnePass(walker, module, input.routeProps, pageContract, undefined, locale);
  for (const w of canonical.warnings) warn(w);
  for (const re of canonical.renderErrors) {
    warn(`route render captured: ${re.error.message}`);
  }
  const canonicalCtx = buildExtractionContext(pageContract, locale, undefined, warn);
  const descendants = canonical.collector.collected.map<DescendantContribution>(
    (c) => {
      const d: DescendantContribution = { contract: c.contract, props: c.props };
      if (c.component !== undefined) d.component = c.component;
      if (c.location !== undefined) d.location = c.location;
      return d;
    },
  );
  const canonicalDraft = aggregatePage({
    page: pageContract,
    pageProps: input.routeProps,
    ctx: canonicalCtx,
    descendants,
    method: 'ssr-walk',
  });
  drafts.push(canonicalDraft);

  // Per-variant passes per PRD-303-R13. Each pass uses a fresh
  // ActCollectorService (and the walker is expected to bootstrap a
  // fresh ApplicationRef + EnvironmentInjector per PRD-303-R13); we
  // MUST NOT reuse the canonical collector per PRD-303-R13.
  const source = input.variantSource ?? 'experiment';
  for (const key of variantKeys) {
    const pass = await renderOnePass(walker, module, input.routeProps, pageContract, key, locale);
    for (const w of pass.warnings) warn(w);
    for (const re of pass.renderErrors) {
      warn(`variant ${key} render captured: ${re.error.message}`);
    }
    const ctx = buildExtractionContext(pageContract, locale, key, warn);
    const variantDescendants = pass.collector.collected.map<DescendantContribution>(
      (c) => {
        const d: DescendantContribution = { contract: c.contract, props: c.props };
        if (c.component !== undefined) d.component = c.component;
        if (c.location !== undefined) d.location = c.location;
        return d;
      },
    );
    const variantDraft = aggregatePage({
      page: pageContract,
      pageProps: input.routeProps,
      ctx,
      descendants: variantDescendants,
      method: 'ssr-walk',
    });
    drafts.push(applyVariantMetadata(variantDraft, pageContract.id, key, source));
  }

  // Sanity: detect duplicate ids inside this route's own emission set
  // (e.g., a variant with a key whose composed id collides with the
  // canonical id). Per PRD-300-R11 this is a build error.
  detectIdCollisions(drafts.map((d) => ({ id: d.id, routeId: pageContract.id })));

  // Bury warnings on the first draft's metadata as a non-normative
  // diagnostic channel so tests / generators can introspect; per
  // PRD-303-R22 the wire shape is `NodeDraft[]` so we keep it minimal.
  if (warnings.length > 0) {
    const head = drafts[0];
    if (head !== undefined) {
      const meta = { ...(head.metadata ?? {}) } as Record<string, unknown>;
      meta['warnings'] = warnings;
      head.metadata = meta;
    }
  }

  return drafts;
}

/** Re-export for binding consumers. */
export { capabilities, composeVariantId, pickStaticContract };
