/**
 * PRD-302-R7 / R10 / R11 / R13 / R14 / R16 / R22 — `extractRoute` for Vue 3.
 *
 * Implements the SSR-walk extraction strategy:
 *   1. Validate the page-level id per PRD-302-R7 (PRD-100-R10/R11).
 *   2. Probe Vue version per PRD-302-R2 (Vue 3+ floor).
 *   3. Resolve the variant key set via `resolveVariantKeys` per PRD-302-R13.
 *   4. For each pass (canonical + per variant): create a fresh Vue app
 *      via `createSSRApp(routeRoot, routeProps)`, install the collector
 *      via `installActProvider`, render the route via
 *      `@vue/server-renderer.renderToString` (which awaits all
 *      `serverPrefetch` promises per PRD-302-R11), drain the collector,
 *      hand to `aggregatePage` per PRD-302-R10.
 *   5. Variant drafts get `metadata.variant` + `variant_of` related per
 *      PRD-300-R18 / R19 via `applyVariantMetadata`.
 *   6. Every emitted block carries `metadata.extracted_via` (R14) +
 *      `metadata.extraction_method: "ssr-walk"` (R15) per the framework
 *      `safeExtract`/`stampMetadata` chain.
 *   7. Render / setup throws are captured by `app.config.errorHandler`
 *      per PRD-302-R16 and surface as additional `marketing:placeholder`
 *      blocks at the end of the route's content list — render continues
 *      past the failed component so descendants still contribute.
 */
import { createSSRApp, version as vueVersion, type Component } from 'vue';
import { renderToString } from '@vue/server-renderer';
import {
  aggregatePage,
  applyVariantMetadata,
  buildPlaceholder,
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
  VUE_BINDING_NAME,
  capabilities,
} from './capabilities.js';
import { VueBindingError } from './errors.js';
import {
  _resetFallbackSentinel,
  createCollectorState,
  fallbackSentinel,
  installActProvider,
  type CollectorState,
} from './provider.js';
import { assertVue3Plus } from './version-gate.js';
import type { VueExtractRouteInput } from './types.js';

interface RenderPassResult {
  collector: CollectorState;
  warnings: string[];
}

/**
 * PRD-302-R10 / R11 — perform one SSR-walk pass. Owns the collector
 * lifecycle: reset fallback sentinel, render under a freshly-created
 * Vue app instance per PRD-302-R13, drain. `renderToString` awaits all
 * `serverPrefetch` promises before resolving (PRD-302-R11) so we never
 * yield partial extractions.
 */
async function renderOnePass(
  routeRoot: Component,
  routeProps: Record<string, unknown> | undefined,
  pageContract: PageContract,
  variant: string | undefined,
): Promise<RenderPassResult> {
  _resetFallbackSentinel();
  const init: { pageContract: PageContract; variant?: string } = {
    pageContract,
  };
  if (variant !== undefined) init.variant = variant;
  const collector = createCollectorState(init);

  // PRD-302-R13 — fresh Vue app per (route, variant) pass; we MUST NOT
  // reuse the canonical render's app for variant emission because variant
  // trees may diverge.
  const app = createSSRApp(routeRoot, routeProps);
  installActProvider(app, { collector });

  const warnings: string[] = [];
  try {
    // PRD-302-R10 / R11 — Vue 3's synchronous SSR pipeline traverses
    // depth-first; renderToString resolves only after serverPrefetch
    // settles. We intentionally do not surface the rendered HTML — the
    // canonical input to PRD-300-R9 aggregation is the collector's
    // contract list per PRD-302-R10.
    await renderToString(app);
  } catch (e) {
    // A top-level render throw lands here when no inner errorHandler
    // catches it (e.g., a synchronous exception in `createSSRApp`'s root
    // setup). Surface as a single placeholder for the route root per
    // PRD-302-R16.
    const err = e instanceof Error ? e : new Error(String(e));
    collector.errors.push({ error: err });
    warnings.push(`route render threw: ${err.message}`);
  }

  // PRD-302-R16 — drain the fallback sentinel so any composable
  // registrations that fired outside the provider scope (defensive
  // guard for misuse) surface as placeholders. Under correct
  // installActProvider wiring this is empty.
  if (fallbackSentinel.composableOutsideProviderCount > 0) {
    for (const _ of Array.from(
      { length: fallbackSentinel.composableOutsideProviderCount },
      (_v, i) => i,
    )) {
      collector.errors.push({
        error: new Error('useActContract called outside an installed ActProvider scope'),
      });
    }
  }
  _resetFallbackSentinel();
  return { collector, warnings };
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
    binding: VUE_BINDING_NAME,
    warn,
  };
}

function appendErrorPlaceholders(draft: NodeDraft, errors: ReadonlyArray<{ error: Error; component?: string; location?: string }>): void {
  for (const captured of errors) {
    const placeholder = buildPlaceholder({
      error: captured.error,
      ...(captured.component !== undefined ? { component: captured.component } : {}),
      ...(captured.location !== undefined ? { location: captured.location } : {}),
    });
    // PRD-302-R15 — also stamp extraction_method on the failure block so
    // generators can attribute the failure to the SSR-walk pass.
    const meta = (placeholder.metadata && typeof placeholder.metadata === 'object'
      ? { ...placeholder.metadata }
      : {}) as Record<string, unknown>;
    meta['extraction_method'] = 'ssr-walk';
    draft.content.push({ ...placeholder, metadata: meta });
  }
}

/**
 * PRD-302-R10 / R13 / R14 / R22 — one route's extraction. Returns the
 * canonical draft plus one draft per declared variant.
 *
 * Per PRD-302-R23 the binding does NOT supply `act_version` or `etag`;
 * the generator (PRD-407 Nuxt) overlays those before serialising.
 */
export async function extractRoute(input: VueExtractRouteInput): Promise<NodeDraft[]> {
  // PRD-302-R2 — Vue 3+ peer floor.
  assertVue3Plus(vueVersion);

  const { pageContract, routeRoot, locale, routeProps } = input;

  // PRD-302-R7 — id grammar/byte-cap gate.
  const idError = validateContractId(pageContract.id);
  if (idError !== null) {
    throw new VueBindingError('PRD-302-R7', idError);
  }

  // PRD-300-R26 — contract_version present on the page contract.
  if (typeof pageContract.contract_version !== 'string'
      || pageContract.contract_version.length === 0) {
    throw new VueBindingError(
      'PRD-302-R7',
      `page contract "${pageContract.id}" missing contract_version`,
    );
  }

  const warnings: string[] = [];
  const warn = (m: string): void => {
    warnings.push(m);
  };

  // PRD-302-R13 — variant key resolution + 64-cap enforcement (rethrows
  // BuildError("PRD-300-R17") on violation).
  const variantKeys = resolveVariantKeys(pageContract.variants, () => []);

  const drafts: NodeDraft[] = [];

  // Canonical pass per PRD-300-R15 / PRD-102-R30.
  const canonical = await renderOnePass(routeRoot, routeProps, pageContract, undefined);
  for (const w of canonical.warnings) warn(w);
  for (const re of canonical.collector.errors) {
    warn(`canonical render captured error: ${re.error.message}`);
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
    pageProps: routeProps,
    ctx: canonicalCtx,
    descendants,
    method: 'ssr-walk',
  });
  // PRD-302-R16 — surface render/setup errors as additional placeholders.
  appendErrorPlaceholders(canonicalDraft, canonical.collector.errors);
  drafts.push(canonicalDraft);

  // Per-variant passes per PRD-302-R13. Each pass uses a fresh Vue app
  // instance + provider scope so trees that diverge per variant collect
  // independently; we MUST NOT reuse the canonical collector per
  // PRD-302-R13.
  const source = input.variantSource ?? 'experiment';
  for (const key of variantKeys) {
    const pass = await renderOnePass(routeRoot, routeProps, pageContract, key);
    for (const w of pass.warnings) warn(w);
    for (const re of pass.collector.errors) {
      warn(`variant ${key} render captured error: ${re.error.message}`);
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
      pageProps: routeProps,
      ctx,
      descendants: variantDescendants,
      method: 'ssr-walk',
    });
    appendErrorPlaceholders(variantDraft, pass.collector.errors);
    drafts.push(applyVariantMetadata(variantDraft, pageContract.id, key, source));
  }

  // Sanity: detect duplicate ids inside this route's own emission set
  // (e.g., a variant whose composed id collides with the canonical id).
  // Per PRD-300-R11 this is a build error.
  detectIdCollisions(drafts.map((d) => ({ id: d.id, routeId: pageContract.id })));

  // Bury warnings on the first draft's metadata as a non-normative
  // diagnostic channel so tests / generators can introspect; per
  // PRD-302-R22 the wire shape is `NodeDraft[]` so we keep it minimal.
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
export { capabilities, composeVariantId };
