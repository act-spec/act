/**
 * PRD-301 React-binding type surface.
 *
 * Mirrors PRD-301 §"Wire format / interface definition" §"React-specific
 * declaration types". React types are referenced via the
 * `peerDependencies`-installed `react` package; consumers MUST provide
 * `react` (and `react-dom`) at install time per PRD-301-R2.
 *
 * The contract object shape is owned by `@act-spec/component-contract`
 * (PRD-300-R2). This file only pins React-specific declaration shapes.
 */
import type * as React from 'react';
import type { ActContract, PageContract } from '@act-spec/component-contract';

/**
 * PRD-301-R3 — static-field declaration pattern. A function or class
 * component carries an `act` static property whose value is an
 * `ActContract<P>` per PRD-300-R2.
 */
export type ReactComponentWithAct<P> = React.FunctionComponent<P> & {
  act?: ActContract<P>;
};

/**
 * PRD-301-R5 — page-level boundary wrapper component. Receives a
 * `contract` prop conforming to `PageContract` and renders its children
 * inside an `<ActProvider>` scope.
 */
export interface ActContractWrapperProps {
  contract: PageContract;
  children: React.ReactNode;
}

/**
 * PRD-301-R10 — provider component the SSR walk wraps a route in. The
 * provider scopes contract collection per (route, variant) pass and is the
 * single sink for `useActContract` hook registrations per PRD-301-R4 / R8.
 */
export interface ActProviderProps {
  children: React.ReactNode;
  /** PRD-301-R5 — page-level contract for the current route, if known. */
  pageContract?: PageContract;
  /** PRD-300-R15 — current variant key for variant replay. */
  variant?: string;
}

/**
 * PRD-301-R22 — input the generator hands `extractRoute`.
 *
 * `routeRoot` is the React element the binding renders; per PRD-301-R10
 * this is typically the route's default export (or the result of calling
 * it with `routeProps`). Generators (PRD-401/404/405/406) supply this
 * after resolving the route module.
 */
export interface ReactExtractRouteInput {
  /** PRD-300-R10 — page-level id. */
  routeId: string;
  /** PRD-301-R22 — the React element the binding renders for SSR walk. */
  routeRoot: React.ReactElement;
  /** PRD-301-R5 — page contract resolved from the route module. */
  pageContract: PageContract;
  /** PRD-300-R32 — build-time-resolved props. */
  routeProps?: unknown;
  /** PRD-104. */
  locale?: string | undefined;
  /** PRD-300-R18 — variant-source declaration when `variants` are emitted. */
  variantSource?: 'experiment' | 'personalization' | 'locale';
}
