/**
 * PRD-301-R4 / R5 / R8 / R10 / R16 — `<ActProvider>` collector + hook.
 *
 * The collector is the single sink for hook registrations during a
 * route's SSR render pass. Per PRD-301-R8 the hook is registration-only;
 * `extract` runs after render completion via `aggregatePage`. The
 * collector records (contract, props) tuples in *render order*, which
 * equals depth-first traversal in React 18's synchronous renderer per
 * PRD-301-R10.
 *
 * Two error modes per PRD-301-R16:
 *  1. Hook called outside a provider → captured as a placeholder when
 *     drained (via `drainHookOutsideProviderFailures`).
 *  2. `useActContract` called inside a server component (RSC) → callers
 *     must invoke the build-time guard `assertNotServerComponent` before
 *     extraction; the hook itself is render-side and cannot detect RSC.
 */
import * as React from 'react';
import { createContext, useContext } from 'react';
import type { ActContract, PageContract } from '@act-spec/component-contract';
import { fromStaticField } from '@act-spec/component-contract';
import type {
  ActContractWrapperProps,
  ActProviderProps,
  ReactComponentWithAct,
} from './types.js';

interface CollectedEntry {
  contract: ActContract<unknown>;
  props: unknown;
  component?: string;
  location?: string;
}

/**
 * Internal mutable state shared across the React tree of one render pass.
 * Bindings construct this *outside* React, hand it to `<ActProvider>`,
 * and read it after render completes per PRD-301-R10.
 */
export interface CollectorState {
  pageContract?: PageContract;
  variant?: string;
  /** PRD-301-R10 — render-order list of hook registrations. */
  collected: CollectedEntry[];
  /**
   * PRD-301-R16 — counter incremented when a hook is called outside a
   * provider. The binding inspects this after render to emit placeholders;
   * we cannot throw inside the hook because that aborts React rendering
   * and prevents descendants from contributing per PRD-301-R16's "render
   * MUST continue past the failed component."
   */
  hookOutsideProviderCount: number;
}

const CollectorCtx = createContext<CollectorState | null>(null);

/**
 * PRD-301-R10 — factory used by the binding to construct a fresh
 * collector per (route, variant) pass. Exported so tests can drain it.
 */
export function createCollectorState(args: {
  pageContract?: PageContract;
  variant?: string;
} = {}): CollectorState {
  const state: CollectorState = {
    collected: [],
    hookOutsideProviderCount: 0,
  };
  if (args.pageContract !== undefined) state.pageContract = args.pageContract;
  if (args.variant !== undefined) state.variant = args.variant;
  return state;
}

/**
 * PRD-301-R10 — provider component the binding wraps the route in. Holds
 * the per-render `CollectorState` so the hook can register contracts
 * against it during render.
 */
export function ActProvider(props: ActProviderProps): React.ReactElement {
  // The binding creates the state *outside* React (so it can read the
  // collected array after render completes); when callers use the
  // component directly they get a fresh per-mount state.
  const stateRef = React.useRef<CollectorState | null>(null);
  if (stateRef.current === null) {
    const init: { pageContract?: PageContract; variant?: string } = {};
    if (props.pageContract !== undefined) init.pageContract = props.pageContract;
    if (props.variant !== undefined) init.variant = props.variant;
    stateRef.current = createCollectorState(init);
  }
  return React.createElement(
    CollectorCtx.Provider,
    { value: stateRef.current },
    props.children,
  );
}

/**
 * Internal provider variant used by `extractRoute`. Threads an
 * externally-owned `CollectorState` so the binding can read it after
 * render completes — `useRef`-based state would be inaccessible from
 * outside React per the renderer's encapsulation.
 */
export function _ActProviderWithState(props: {
  state: CollectorState;
  children: React.ReactNode;
}): React.ReactElement {
  return React.createElement(
    CollectorCtx.Provider,
    { value: props.state },
    props.children,
  );
}

/**
 * PRD-301-R5 — page-level boundary wrapper component. Sets the page
 * contract on the surrounding collector when used at non-route layout
 * boundaries; preferred form per PRD-301-R5 is the exported `act` const
 * on the route module.
 */
export function ActContractWrapper(
  props: ActContractWrapperProps,
): React.ReactElement {
  const state = useContext(CollectorCtx);
  if (state !== null && state.pageContract === undefined) {
    state.pageContract = props.contract;
  }
  return React.createElement(React.Fragment, null, props.children);
}

/**
 * PRD-301-R4 / R8 — hook declaration pattern. Records the contract
 * against the current collector; `extract` is NOT invoked here per
 * PRD-301-R8 (the framework's `safeExtract` runs it once after the
 * provider drains the collector via `aggregatePage`).
 *
 * On a missing provider the hook does NOT throw (would abort the React
 * render and prevent descendants from contributing per PRD-301-R16);
 * instead it bumps the collector-outside counter on a sentinel state so
 * the binding can emit a placeholder per PRD-301-R16 once render
 * completes. We surface this via the `hookOutsideProviderCount` on the
 * thread-local sentinel below.
 */
export function useActContract<P = unknown>(contract: ActContract<P>, props?: P): void {
  const state = useContext(CollectorCtx);
  if (state === null) {
    // PRD-301-R16 — no provider; record on the sentinel so the binding
    // can emit a placeholder. We bump the module-level fallback so
    // `<ActProvider>`-less rendering surfaces as a placeholder upstream.
    fallbackSentinel.hookOutsideProviderCount += 1;
    fallbackSentinel.collected.push({
      contract: contract as ActContract<unknown>,
      props: props,
    });
    return;
  }
  state.collected.push({
    contract: contract as ActContract<unknown>,
    props: props,
  });
}

/**
 * PRD-301-R3 — helper that registers a static-field component's contract
 * against the current collector and renders the component. Authors who
 * declare via the static-field pattern wrap usages as
 * `<ActSection of={Hero} {...heroProps} />`. The wrapper desugars to the
 * same hook registration per PRD-301-R6 (all three forms equivalent).
 */
export function ActSection<P extends object>(
  props: { of: ReactComponentWithAct<P>; component?: string; location?: string } & P,
): React.ReactElement | null {
  const { of: Component, component, location, ...rest } = props as {
    of: ReactComponentWithAct<P>;
    component?: string;
    location?: string;
  } & Record<string, unknown>;
  const state = useContext(CollectorCtx);
  const contract = fromStaticField(Component);
  if (contract !== undefined) {
    if (state === null) {
      fallbackSentinel.hookOutsideProviderCount += 1;
      fallbackSentinel.collected.push({
        contract: contract as ActContract<unknown>,
        props: rest,
      });
    } else {
      const entry: CollectedEntry = {
        contract: contract as ActContract<unknown>,
        props: rest,
      };
      if (component !== undefined) entry.component = component;
      if (location !== undefined) entry.location = location;
      state.collected.push(entry);
    }
  }
  return React.createElement(Component as React.FunctionComponent<P>, rest as unknown as P);
}

/** PRD-301-R10 — read the collector for the current scope (testing helper). */
export function useCollectorState(): CollectorState | null {
  return useContext(CollectorCtx);
}

/**
 * Module-level fallback sentinel. When a hook fires outside any
 * `<ActProvider>`, the registration lands here. The binding drains it
 * before/after extractRoute (single-threaded SSR) — see PRD-301-R16.
 *
 * Concurrent renders (PRD-301-R20 `concurrent: true`) inside one
 * worker MUST go through `extractRoute`, which scopes via per-route
 * `CollectorState` and never relies on this sentinel for correctness.
 */
export const fallbackSentinel: CollectorState = {
  collected: [],
  hookOutsideProviderCount: 0,
};

/** Reset the fallback sentinel (called by `extractRoute` between renders). */
export function _resetFallbackSentinel(): void {
  fallbackSentinel.collected = [];
  fallbackSentinel.hookOutsideProviderCount = 0;
}
