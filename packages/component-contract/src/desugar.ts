/**
 * PRD-300-R1 / R2 / R3 — desugaring the three declaration patterns
 * (static field, hook, decorator) to the canonical `ActContract` shape.
 *
 * Per gap D1 the three patterns MUST produce byte-identical canonical
 * objects given identical inputs; this module encodes the convergence
 * point. Bindings (PRD-301/302/303) wrap these helpers with
 * framework-specific glue (e.g., the React binding's `<ActProvider>`
 * collects hook registrations during a render pass).
 */
import type { ActContract } from './types.js';

/**
 * PRD-300-R1 / R3 — Pattern 1 (static field). The framework hands the
 * binding a component carrying `.act` on its function/class.
 */
export function fromStaticField<P>(
  component: { act?: ActContract<P> } | undefined | null,
): ActContract<P> | undefined {
  if (component === undefined || component === null) return undefined;
  return component.act;
}

/**
 * PRD-300-R3 / R4 — Pattern 2 (hook). The hook records the contract
 * against an instance key during render; the binding's provider drains
 * the registry once per (component instance, variant) pass.
 *
 * The framework keeps the registry behind a closure so bindings cannot
 * reach in and mutate it directly; tests and bindings use the returned
 * `register` / `lookup` / `clear` functions.
 */
export interface HookRegistry<P = unknown> {
  /** PRD-300-R4 — replaces (single contract per instance per pass). */
  register: (instance: object, contract: ActContract<P>) => void;
  /** PRD-300-R3 — read the contract for an instance during traversal. */
  lookup: (instance: object) => ActContract<P> | undefined;
  /** PRD-300-R4 — invoked between extraction passes. */
  clear: () => void;
  /** PRD-300-R4 — count of registered contracts (for assertion in tests). */
  size: () => number;
}

export function createHookRegistry<P = unknown>(): HookRegistry<P> {
  const store = new WeakMap<object, ActContract<P>>();
  // WeakMap doesn't expose `.size`; we keep a side counter that decreases
  // when `clear` is called and otherwise reports the upper-bound count.
  // For PRD-300-R4 the counter is sufficient (tests assert "extract not
  // re-invoked across renders", not the GC-weak object count).
  const seen = new Set<object>();
  return {
    register(instance, contract) {
      store.set(instance, contract);
      seen.add(instance);
    },
    lookup(instance) {
      return store.get(instance);
    },
    clear() {
      for (const k of seen) store.delete(k);
      seen.clear();
    },
    size() {
      return seen.size;
    },
  };
}

/**
 * PRD-300-R3 — Pattern 3 (decorator). Decorators stash the contract on
 * the class under the well-known global symbol so independent module
 * trees still converge.
 */
export const DECORATOR_KEY: unique symbol = Symbol.for('@act-spec/component-contract:contract');

export function fromDecorator<P>(
  cls: { [DECORATOR_KEY]?: ActContract<P> } | undefined | null,
): ActContract<P> | undefined {
  if (cls === undefined || cls === null) return undefined;
  return cls[DECORATOR_KEY];
}

/** Setter form used by leaf decorators (`@act(...)` -> `attachDecoratorContract(target, contract)`). */
export function attachDecoratorContract<P>(
  cls: { [DECORATOR_KEY]?: ActContract<P> },
  contract: ActContract<P>,
): void {
  cls[DECORATOR_KEY] = contract;
}
