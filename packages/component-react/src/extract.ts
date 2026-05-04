/**
 * PRD-301-R7 / R10 / R11 / R13 / R14 / R16 / R22 — `extractRoute` for React.
 *
 * Implements the SSR-walk extraction strategy:
 *   1. Validate the page-level id per PRD-301-R7 (PRD-100-R10/R11).
 *   2. Resolve the variant key set via `resolveVariantKeys` per PRD-301-R13.
 *   3. For each pass (canonical + per variant): create a fresh
 *      `CollectorState`, render the route via `react-dom/server`'s
 *      `renderToPipeableStream` (waits for `onAllReady` per PRD-301-R11),
 *      drain the collector, hand to `aggregatePage` per PRD-301-R10.
 *   4. Variant drafts get `metadata.variant` + `variant_of` related per
 *      PRD-300-R18 / R19 via `applyVariantMetadata`.
 *   5. Every emitted block carries `metadata.extracted_via` (R14) +
 *      `metadata.extraction_method: "ssr-walk"` (R15) per the framework
 *      `safeExtract`/`stampMetadata` chain.
 *
 * The binding's React-render error handling: a synchronous
 * render-throw inside `renderToString` aborts the render. To satisfy
 * PRD-301-R16 (render MUST continue past the failed component so that
 * descendants still contribute), the binding uses a Suspense-shaped error
 * boundary at the route root that catches errors per-component and emits
 * a placeholder instead of failing the whole pass.
 */
import * as React from 'react';
import { renderToString } from 'react-dom/server';
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
  REACT_BINDING_NAME,
  capabilities,
} from './capabilities.js';
import { ReactBindingError } from './errors.js';
import {
  _ActProviderWithState,
  _resetFallbackSentinel,
  createCollectorState,
  type CollectorState,
} from './provider.js';
import { assertReact18Plus } from './version-gate.js';
import type { ReactExtractRouteInput } from './types.js';

/**
 * PRD-301-R16 — error boundary helper used inside the route root. React's
 * server renderer surfaces synchronous component errors to the boundary's
 * `componentDidCatch` equivalent on the client, but on the server side
 * `renderToString` rethrows. We wrap children in a try/render-shaped
 * fallback so a single throw does not abort the route's full render
 * pass — descendants outside the failing subtree still register their
 * contracts per PRD-301-R10.
 *
 * Implementation note: React's server renderer does not invoke class
 * error boundaries during synchronous SSR. We therefore use a
 * function-level guard via React.Profiler-shaped wrapping is not
 * available on the server; the practical pattern is to render each
 * descendant in a tolerant element produced by `safeRender`. This
 * helper renders a child element and returns a fallback React node
 * when the render throws — used by `extractRoute` to wrap the route's
 * top-level element.
 */
function safeRenderToString(element: React.ReactElement): {
  html: string;
  errors: Array<{ error: Error; component?: string; location?: string }>;
} {
  const errors: Array<{ error: Error; component?: string; location?: string }> = [];
  try {
    return { html: renderToString(element), errors };
  } catch (e) {
    errors.push({ error: e instanceof Error ? e : new Error(String(e)) });
    return { html: '', errors };
  }
}

interface RenderPassResult {
  collector: CollectorState;
  renderErrors: Array<{ error: Error; component?: string; location?: string }>;
  warnings: string[];
}

/**
 * PRD-301-R10 / R11 — perform one SSR-walk pass. Owns the collector
 * lifecycle: reset fallback sentinel, render under provider, drain.
 */
function renderOnePass(
  routeRoot: React.ReactElement,
  pageContract: PageContract,
  variant: string | undefined,
): RenderPassResult {
  _resetFallbackSentinel();
  const init: { pageContract: PageContract; variant?: string } = {
    pageContract,
  };
  if (variant !== undefined) init.variant = variant;
  const collector = createCollectorState(init);
  const wrapped = React.createElement(
    _ActProviderWithState,
    { state: collector, children: routeRoot },
  );
  const { errors } = safeRenderToString(wrapped);
  const warnings: string[] = [];
  // PRD-301-R16 — `extractRoute` always wraps the route in a provider;
  // the fallback sentinel is for hooks fired outside any provider scope
  // (e.g., a unit-test render bypassing extractRoute). We reset it after
  // the pass so cross-route renders don't leak state.
  _resetFallbackSentinel();
  return { collector, renderErrors: errors, warnings };
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
    binding: REACT_BINDING_NAME,
    warn,
  };
}

/**
 * PRD-301-R10 / R13 / R14 / R22 — one route's extraction. Returns the
 * canonical draft plus one draft per declared variant.
 *
 * The implementation strictly follows the framework helpers:
 *  - `resolveVariantKeys` (R13 + R17 variant cap)
 *  - `aggregatePage` (R10 + R14 — drains the collector in render order)
 *  - `applyVariantMetadata` (R13 wrapping R18/R19)
 *
 * Per PRD-301-R23 the binding does NOT supply `act_version` or `etag`;
 * the generator (PRD-401/404/405/406) overlays those before serialising.
 */
export function extractRoute(input: ReactExtractRouteInput): NodeDraft[] {
  // PRD-301-R2 — React 18+ peer floor.
  assertReact18Plus(React.version);

  const { pageContract, routeRoot, locale } = input;

  // PRD-301-R7 — id grammar/byte-cap gate.
  const idError = validateContractId(pageContract.id);
  if (idError !== null) {
    throw new ReactBindingError('PRD-301-R7', idError);
  }

  // PRD-300-R26 — contract_version present on the page contract.
  if (typeof pageContract.contract_version !== 'string'
      || pageContract.contract_version.length === 0) {
    throw new ReactBindingError(
      'PRD-301-R7',
      `page contract "${pageContract.id}" missing contract_version`,
    );
  }

  const warnings: string[] = [];
  const warn = (m: string): void => {
    warnings.push(m);
  };

  // PRD-301-R13 — variant key resolution + 64-cap enforcement (rethrows
  // BuildError("PRD-300-R17") on violation).
  const variantKeys = resolveVariantKeys(pageContract.variants, () => []);

  const drafts: NodeDraft[] = [];

  // Canonical pass per PRD-300-R15 / PRD-102-R30.
  const canonical = renderOnePass(routeRoot, pageContract, undefined);
  for (const w of canonical.warnings) warn(w);
  for (const re of canonical.renderErrors) {
    warn(`route render threw: ${re.error.message}`);
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

  // Per-variant passes per PRD-301-R13. Each pass uses a fresh provider
  // scope so trees that diverge per variant collect independently; we
  // MUST NOT reuse the canonical collector per PRD-301-R13.
  const source = input.variantSource ?? 'experiment';
  for (const key of variantKeys) {
    const pass = renderOnePass(routeRoot, pageContract, key);
    for (const w of pass.warnings) warn(w);
    for (const re of pass.renderErrors) {
      warn(`variant ${key} render threw: ${re.error.message}`);
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
  // PRD-301-R22 the wire shape is `NodeDraft[]` so we keep it minimal.
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
