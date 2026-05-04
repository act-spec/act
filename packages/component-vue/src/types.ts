/**
 * PRD-302 Vue-binding type surface.
 *
 * Mirrors PRD-302 §"Wire format / interface definition" §"Vue-specific
 * declaration types". Vue types are referenced via the
 * `peerDependencies`-installed `vue` package; consumers MUST provide
 * `vue` (and `@vue/server-renderer`) at install time per PRD-302-R2.
 *
 * The contract object shape is owned by `@act-spec/component-contract`
 * (PRD-300-R2). This file only pins Vue-specific declaration shapes.
 */
import type { Component } from 'vue';
import type { ActContract, PageContract } from '@act-spec/component-contract';

/**
 * PRD-302-R3 — static-field declaration pattern. A Vue component (the
 * default export of an SFC, typically) carries an `act` static property
 * whose value is an `ActContract<P>` per PRD-300-R2.
 */
export type VueComponentWithAct<P> = Component & {
  act?: ActContract<P>;
};

/**
 * PRD-302-R5 — page-level boundary wrapper component options. Receives a
 * `contract` prop conforming to `PageContract` and renders its slot
 * inside an `ActProvider`-equivalent scope.
 */
export interface ActSectionProps {
  contract: PageContract;
}

/**
 * PRD-302-R22 — input the generator hands `extractRoute`.
 *
 * `routeRoot` is the Vue component the binding renders. The binding
 * creates a fresh Vue app via `createSSRApp(routeRoot, routeProps)` per
 * PRD-302-R10. Generators (PRD-407 Nuxt) supply this after resolving the
 * route module.
 */
export interface VueExtractRouteInput {
  /** PRD-300-R10 — page-level id. */
  routeId: string;
  /** PRD-302-R22 — the Vue component the binding renders for SSR walk. */
  routeRoot: Component;
  /** PRD-302-R5 — page contract resolved from the route module. */
  pageContract: PageContract;
  /** PRD-300-R32 — build-time-resolved props. */
  routeProps?: Record<string, unknown>;
  /** PRD-104. */
  locale?: string | undefined;
  /** PRD-300-R18 — variant-source declaration when `variants` are emitted. */
  variantSource?: 'experiment' | 'personalization' | 'locale';
}
