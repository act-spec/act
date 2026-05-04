/**
 * PRD-302-R4 / R5 / R8 / R10 / R16 — provide/inject collector + composable.
 *
 * The collector is the single sink for `useActContract` registrations
 * during a route's SSR render pass. Per PRD-302-R8 the composable is
 * registration-only; `extract` runs after render completion via
 * `aggregatePage`. The collector records (contract, props) tuples in
 * *render order* — Vue 3's synchronous SSR pipeline traverses the
 * component tree depth-first, top-to-bottom per PRD-302-R10.
 *
 * Failure modes per PRD-302-R16:
 *  1. Composable called outside an `installActProvider` scope → captured
 *     on the module-level fallback sentinel and surfaced as a placeholder
 *     when drained.
 *  2. Component throws during `setup()` / render → captured by
 *     `app.config.errorHandler`; the binding emits a placeholder for the
 *     failed component while render continues past it (per PRD-302-R16).
 */
import { getCurrentInstance, inject, provide, type App, type InjectionKey } from 'vue';
import type { ActContract, PageContract } from '@act-spec/component-contract';
import { fromStaticField } from '@act-spec/component-contract';
import type { VueComponentWithAct } from './types.js';

interface CollectedEntry {
  contract: ActContract<unknown>;
  props: unknown;
  /** PRD-302-R8 — `getCurrentInstance().uid` for dedupe per (instance, variant). */
  instanceUid?: number;
  component?: string;
  location?: string;
}

interface CapturedError {
  error: Error;
  component?: string;
  location?: string;
  /** Vue's `info` string from `app.config.errorHandler`. */
  info?: string;
}

/**
 * Internal mutable state shared across the Vue tree of one render pass.
 * Bindings construct this *outside* Vue, hand it to `installActProvider`,
 * and read it after render completes per PRD-302-R10.
 */
export interface CollectorState {
  pageContract?: PageContract;
  variant?: string;
  /** PRD-302-R10 — render-order list of composable registrations. */
  collected: CollectedEntry[];
  /**
   * PRD-302-R8 — set of instance uids already registered to enforce
   * "at most once per (component instance, variant)" within one render
   * pass. The composable is registration-only; this guards against a
   * defensive composable double-call inside the same `setup()`.
   */
  seenUids: Set<number>;
  /**
   * PRD-302-R16 — render / setup errors captured via
   * `app.config.errorHandler`. The binding drains these after render and
   * emits a `marketing:placeholder` per error.
   */
  errors: CapturedError[];
  /**
   * PRD-302-R16 — counter incremented when a composable is called outside
   * any installed provider. The binding emits a placeholder per
   * occurrence.
   */
  composableOutsideProviderCount: number;
}

/** PRD-302-R10 — provide/inject key. */
export const COLLECTOR_KEY: InjectionKey<CollectorState> =
  Symbol.for('@act-spec/component-vue/collector');

/**
 * PRD-302-R10 — factory used by the binding to construct a fresh
 * collector per (route, variant) pass. Exported so tests can drain it.
 */
export function createCollectorState(args: {
  pageContract?: PageContract;
  variant?: string;
} = {}): CollectorState {
  const state: CollectorState = {
    collected: [],
    seenUids: new Set<number>(),
    errors: [],
    composableOutsideProviderCount: 0,
  };
  if (args.pageContract !== undefined) state.pageContract = args.pageContract;
  if (args.variant !== undefined) state.variant = args.variant;
  return state;
}

/**
 * PRD-302-R10 / R16 — install the collector on a Vue app. Wires
 * `app.config.errorHandler` so render / setup throws become placeholders
 * per PRD-302-R16 instead of aborting the whole render. Returns the
 * collector state so the binding can drain it after `renderToString`
 * settles.
 */
export function installActProvider(
  app: App,
  opts: { pageContract?: PageContract; variant?: string; collector?: CollectorState } = {},
): CollectorState {
  const init: { pageContract?: PageContract; variant?: string } = {};
  if (opts.pageContract !== undefined) init.pageContract = opts.pageContract;
  if (opts.variant !== undefined) init.variant = opts.variant;
  const state = opts.collector ?? createCollectorState(init);
  app.provide(COLLECTOR_KEY, state);

  // PRD-302-R16 — capture render / setup errors so render continues past
  // the failed component and descendants can still contribute their
  // contracts via the composable.
  app.config.errorHandler = (err, instance, info): void => {
    const e = err instanceof Error ? err : new Error(String(err));
    const captured: CapturedError = { error: e, info };
    // Vue exposes the component on the instance via `$options.name` or
    // `type.name` / `type.__name`; we read defensively.
    const compName = readComponentName(instance);
    if (compName !== undefined) captured.component = compName;
    state.errors.push(captured);
  };
  return state;
}

function readComponentName(instance: unknown): string | undefined {
  if (instance === null || typeof instance !== 'object') return undefined;
  const i = instance as {
    type?: { name?: unknown; __name?: unknown };
    $options?: { name?: unknown };
  };
  const fromType = i.type?.name ?? i.type?.__name;
  if (typeof fromType === 'string' && fromType.length > 0) return fromType;
  const fromOpts = i.$options?.name;
  if (typeof fromOpts === 'string' && fromOpts.length > 0) return fromOpts;
  return undefined;
}

/**
 * PRD-302-R4 / R8 — composable declaration pattern. Records the contract
 * against the current collector keyed by `getCurrentInstance().uid`;
 * `extract` is NOT invoked here per PRD-302-R8 (the framework's
 * `safeExtract` runs it once after the provider drains the collector via
 * `aggregatePage`).
 *
 * On a missing provider the composable does NOT throw (would abort the
 * Vue render and prevent descendants from contributing per PRD-302-R16);
 * instead it bumps the fallback sentinel so the binding can emit a
 * placeholder per PRD-302-R16 once render completes.
 *
 * The `props` argument is OPTIONAL: in many SFC patterns the composable
 * is called from inside `setup(props)` and the author closes over `props`
 * directly inside `extract`. Passing them through keeps the binding's
 * `safeExtract` happy when the contract is defined externally.
 */
export function useActContract<P = unknown>(contract: ActContract<P>, props?: P): void {
  const state = inject(COLLECTOR_KEY, null);
  const inst = getCurrentInstance();
  if (state === null) {
    fallbackSentinel.composableOutsideProviderCount += 1;
    fallbackSentinel.collected.push({
      contract: contract as ActContract<unknown>,
      props,
    });
    return;
  }
  if (inst !== null) {
    if (state.seenUids.has(inst.uid)) return;
    state.seenUids.add(inst.uid);
  }
  const entry: CollectedEntry = {
    contract: contract as ActContract<unknown>,
    props,
  };
  if (inst !== null) entry.instanceUid = inst.uid;
  state.collected.push(entry);
}

/**
 * PRD-302-R3 — helper that registers a static-field component's contract
 * against the current collector. Authors who declare via the static-field
 * pattern (Component.act = {...}) MAY use this composable from inside the
 * component's own `setup()` to register the contract; the macro / provider
 * walks the registration list after render. Also usable as the engine
 * behind a future `<ActSection>` wrapper.
 */
export function useActStatic<P = unknown>(
  Component: VueComponentWithAct<P>,
  props?: P,
  opts?: { component?: string; location?: string },
): void {
  const contract = fromStaticField(Component);
  if (contract === undefined) return;
  const state = inject(COLLECTOR_KEY, null);
  const inst = getCurrentInstance();
  if (state === null) {
    fallbackSentinel.composableOutsideProviderCount += 1;
    fallbackSentinel.collected.push({
      contract: contract as ActContract<unknown>,
      props,
    });
    return;
  }
  if (inst !== null) {
    if (state.seenUids.has(inst.uid)) return;
    state.seenUids.add(inst.uid);
  }
  const entry: CollectedEntry = {
    contract: contract as ActContract<unknown>,
    props,
  };
  if (inst !== null) entry.instanceUid = inst.uid;
  if (opts?.component !== undefined) entry.component = opts.component;
  if (opts?.location !== undefined) entry.location = opts.location;
  state.collected.push(entry);
}

/**
 * PRD-302-R5 — `defineActContract({...})` page-/component-level macro form.
 *
 * In real `<script setup>` SFC code, the macro is processed by the
 * binding's Vite plugin and rewritten to a `useActContract({...})` call;
 * runtime behavior is identical to the composable. Exported here for two
 * reasons:
 *   1. Authors can call it directly inside any `setup()`-shaped function
 *      to declare a contract without the SFC-only macro syntax.
 *   2. Tests exercise the runtime-equivalent path that the macro lowers to.
 *
 * The function is a pass-through to `useActContract`; the only behavioral
 * difference is intent (page-level vs component-level), which is a
 * declaration-site distinction and not visible at the runtime layer.
 */
export function defineActContract<P = unknown>(contract: ActContract<P>, props?: P): void {
  useActContract(contract, props);
}

/**
 * Module-level fallback sentinel. When a composable fires outside any
 * `installActProvider` scope, the registration lands here. The binding
 * drains it before/after extractRoute (single-threaded SSR) — see
 * PRD-302-R16. Concurrent renders (PRD-302-R20 `concurrent: true`)
 * inside one worker MUST go through `extractRoute`, which scopes via
 * per-route `CollectorState` and never relies on this sentinel for
 * correctness.
 */
export const fallbackSentinel: CollectorState = {
  collected: [],
  seenUids: new Set<number>(),
  errors: [],
  composableOutsideProviderCount: 0,
};

/** Reset the fallback sentinel (called by `extractRoute` between renders). */
export function _resetFallbackSentinel(): void {
  fallbackSentinel.collected = [];
  fallbackSentinel.seenUids = new Set<number>();
  fallbackSentinel.errors = [];
  fallbackSentinel.composableOutsideProviderCount = 0;
}

/** Provide-side helper for nested layouts that want to attach a child collector. */
export function provideCollectorState(state: CollectorState): void {
  provide(COLLECTOR_KEY, state);
}
