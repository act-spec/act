/**
 * PRD-301-R20 — React binding capability declaration.
 *
 * Pinned per the table in PRD-301-R20. Every flag MUST be set truthfully
 * per PRD-300-R28; the values below reflect what the v0.1 binding actually
 * supports. The headless-render flag defaults to `false`; opt-in is via a
 * future `@act-spec/component-react/headless` sub-export (PRD-301-R26).
 */
import type { BindingCapabilities } from '@act-spec/component-contract';

/**
 * PRD-301-R20 — default capability matrix for `@act-spec/component-react`.
 *
 * The PRD-301-R20 table pins `streaming: true`, `suspense: true`,
 * `static-ast: true`. Per PRD-300-R28 every flag MUST be set truthfully
 * (and PRD-301-R20 reiterates this requirement). The v0.1 binding
 * currently uses `react-dom/server.renderToString` (synchronous,
 * non-streaming), does NOT implement the Babel/SWC static-AST plugin
 * (PRD-301-R24/R25), and does NOT bundle the headless-render path.
 *
 * The honest Core-band matrix below sets the unimplemented flags to
 * `false`; the values that the published PRD-301-R20 table targets are
 * a follow-up implementation milestone. Filed as amendment A15 in
 * `docs/amendments-queue.md`.
 */
export const capabilities: BindingCapabilities = {
  'ssr-walk': true,
  // PRD-301-R24 / R25 — Plus band; Babel/SWC plugin not yet shipped.
  'static-ast': false,
  // PRD-301-R26 — Plus band; opt-in sub-export not yet shipped.
  'headless-render': false,
  // PRD-301-R12 — RSC walk guard implemented in `rsc-guard.ts`; the
  // server-tree-only walk depends on the host generator (PRD-405) wiring
  // the discovered modules through `assertHookNotInServerComponent`. The
  // binding-side guard is shipped, so the flag is true.
  rsc: true,
  // PRD-301-R11 — Standard band; streaming SSR (`renderToPipeableStream`
  // + `onAllReady`) not yet wired. `false` until the path lands.
  streaming: false,
  // PRD-301-R20 — `<Suspense>` boundary support during extraction
  // depends on streaming (sync `renderToString` does not wait for
  // suspended boundaries). `false` until streaming lands.
  suspense: false,
  // Per-route extraction uses an externally-owned `CollectorState`
  // threaded through React context per render; safe to invoke
  // concurrently across distinct routes.
  concurrent: true,
};

/**
 * PRD-301-R20 / PRD-301-R26 — capability matrix the headless sub-export
 * publishes. Identical to `capabilities` except `headless-render: true`.
 * Surfaced here so the type stays in lock-step with the default matrix
 * even though the actual sub-export ships in a follow-up phase.
 */
export const headlessCapabilities: BindingCapabilities = {
  ...capabilities,
  'headless-render': true,
};

/** PRD-301-R21 — the contract MAJOR.MINOR this binding implements. */
export const REACT_BINDING_CONTRACT_VERSION = '0.1' as const;

/** PRD-301-R1 — the binding's published name. */
export const REACT_BINDING_NAME = '@act-spec/component-react' as const;
