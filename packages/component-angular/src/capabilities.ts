/**
 * PRD-303-R20 — Angular binding capability declaration.
 *
 * Pinned per the table in PRD-303-R20. Per A15 (PRD-301 truthfulness
 * qualification, applied symmetrically here): every flag MUST be set
 * truthfully per PRD-300-R28; the values below reflect what the v0.1
 * binding actually supports, NOT the PRD-303-R20 published target table.
 *
 * The PRD-303-R20 target table pins `static-ast: true` (Plus band — the
 * `@angular/compiler-cli`-driven scanner is a follow-up implementation
 * milestone that has not yet shipped). Per A15's posture, the binding
 * publishes `static-ast: false` until the scanner lands; flipping it to
 * `true` is MINOR per PRD-108-R4(5) once shipped.
 *
 * `headless-render`, `rsc`, `streaming`, `suspense` all pin `false` per
 * the PRD-303-R20 table itself (no first-class Angular equivalents in
 * v0.1). `ssr-walk` and `concurrent` pin `true` per the table.
 */
import type { BindingCapabilities } from '@act-spec/component-contract';

/**
 * PRD-303-R20 — default capability matrix for `@act-spec/component-angular`.
 *
 * v0.1 reference binding ships:
 *  - `ssr-walk: true`     — the canonical mode; the binding wraps
 *    `@angular/platform-server.renderApplication` and awaits
 *    `ApplicationRef.isStable` per PRD-303-R10.
 *  - `static-ast: false`  — A15 posture; the `@angular/compiler-cli`
 *    scanner (PRD-303-R24/R25) is a follow-up milestone. Flipped to
 *    `true` once the scanner lands (MINOR per PRD-108-R4(5)).
 *  - `headless-render: false` — not shipped in v0.1 (PRD-303-R20).
 *  - `rsc: false`         — Angular has no first-class RSC equivalent
 *    in v0.1 (PRD-303-R20 + PRD-300-R30). Reserved for a future
 *    Angular feature.
 *  - `streaming: false`   — Angular's SSR pipeline does not expose a
 *    public streaming API in v0.1; `renderApplication` returns a fully
 *    rendered string. The binding's `ApplicationRef.isStable` wait
 *    (PRD-303-R10) satisfies PRD-300-R31 even with `streaming: false`.
 *  - `suspense: false`    — no first-class equivalent in Angular's
 *    public API in v0.1 (PRD-303-R20). Angular's `defer` block is
 *    template-side and resolves before `isStable` emits.
 *  - `concurrent: true`   — per-route extraction uses a fresh
 *    `ApplicationRef` + `EnvironmentInjector` per render; safe to
 *    invoke concurrently across distinct routes per PRD-303-R20.
 */
export const capabilities: BindingCapabilities = {
  'ssr-walk': true,
  // PRD-303-R24 / R25 — Plus band; @angular/compiler-cli scanner not yet shipped.
  // Flips to true once the static-AST scanner lands (MINOR per PRD-108-R4(5)).
  'static-ast': false,
  // PRD-303-R20 — not shipped in v0.1.
  'headless-render': false,
  // PRD-303-R20 — Angular has no first-class RSC equivalent in v0.1.
  rsc: false,
  // PRD-303-R20 — Angular's SSR has no public streaming API in v0.1.
  streaming: false,
  // PRD-303-R20 — no first-class `<Suspense>` equivalent in Angular's public API.
  suspense: false,
  // PRD-303-R20 — fresh ApplicationRef + EnvironmentInjector per render.
  concurrent: true,
};

/** PRD-303-R21 — the contract MAJOR.MINOR this binding implements. */
export const ANGULAR_BINDING_CONTRACT_VERSION = '0.1' as const;

/** PRD-303-R1 — the binding's published name. */
export const ANGULAR_BINDING_NAME = '@act-spec/component-angular' as const;
