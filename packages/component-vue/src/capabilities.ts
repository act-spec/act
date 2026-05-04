/**
 * PRD-302-R20 — Vue binding capability declaration.
 *
 * Per A15 (capability-table truthfulness, applied across PRD-301/302/303),
 * the v0.1 binding sets only the flags it actually implements to `true`.
 * The PRD-302-R20 published target table is the eventual milestone; until
 * the streaming/static-AST/headless paths land, those flags stay `false`
 * to satisfy PRD-300-R28's truthfulness MUST.
 */
import type { BindingCapabilities } from '@act-spec/component-contract';

/**
 * PRD-302-R20 — default capability matrix for `@act-spec/component-vue`.
 *
 * v0.1 honest matrix (per A15):
 *  - `ssr-walk: true` — canonical path via `@vue/server-renderer.renderToString`.
 *  - `static-ast: false` — no `@vue/compiler-sfc`-driven scanner ships in v0.1
 *    (PRD-302-R24 / R25 are Plus-band; follow-up milestone).
 *  - `headless-render: false` — Vue 3 SSR is the canonical path; no headless
 *    shipping in v0.1 (PRD-302-R20 explicitly pins this `false`).
 *  - `rsc: false` — Vue 3 has no RSC equivalent in v0.1 (PRD-302-R20 pins
 *    this `false`; reserved for v0.2 review).
 *  - `streaming: false` — `renderToWebStream` path not yet wired; the v0.1
 *    binding ships only the synchronous-await `renderToString` path.
 *  - `suspense: false` — depends on the streaming path; flips with streaming.
 *  - `concurrent: true` — per-route extraction creates a fresh Vue app
 *    instance per call; safe to invoke concurrently across distinct routes.
 */
export const capabilities: BindingCapabilities = {
  'ssr-walk': true,
  'static-ast': false,
  'headless-render': false,
  rsc: false,
  streaming: false,
  suspense: false,
  concurrent: true,
};

/** PRD-302-R21 — the contract MAJOR.MINOR this binding implements. */
export const VUE_BINDING_CONTRACT_VERSION = '0.1' as const;

/** PRD-302-R1 — the binding's published name. */
export const VUE_BINDING_NAME = '@act-spec/component-vue' as const;
