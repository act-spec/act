/**
 * PRD-303-R4 / R7 / R8 / R10 / R11 / R16 — Angular collector + service.
 *
 * The collector is the single sink for contract registrations during a
 * route's SSR render pass. Per PRD-303-R8 the service is registration-
 * only; `extract` runs after render completion via `aggregatePage`. The
 * collector records (contract, props) tuples in *render order*, which
 * equals depth-first traversal in Angular's SSR pipeline per
 * PRD-303-R10.
 *
 * Three error modes per PRD-303-R16:
 *  1. Service called outside an installed `ActCollectorService` scope →
 *     captured as a placeholder when drained.
 *  2. Structural directive used outside the collector's scope → same.
 *  3. Nested page-level `*actSection` → throws PRD-303-R11 build error
 *     at registration time per PRD-303-R11 (mirrors the React static-
 *     field rule).
 *
 * Per PRD-303-R7 the collector MUST be installed at the COMPONENT level
 * (`providers: [ActCollectorService]` on the bootstrap component), never
 * at root. Installing at root would leak per-render state across SSR
 * runs producing non-deterministic extractions across builds. The
 * binding's `extractRoute` enforces this; authors using the binding
 * manually MUST follow the documented installation path. The check is
 * exposed as `assertCollectorScopeIsComponentLocal` for tests.
 *
 * The classes in this module are framework-agnostic by design (per A15
 * truthfulness posture — testing the collector logic does not require
 * booting Angular's runtime). When wired into an Angular app the same
 * classes are decorated as `@Injectable()` services; the binding ships
 * them un-decorated and consumers MAY register them via
 * `{ provide: ActCollectorService, useClass: ActCollectorService }` in
 * their bootstrap providers.
 */
import type { ActContract, PageContract } from '@act-spec/component-contract';
import { AngularBindingError } from './errors.js';

interface CollectedEntry {
  contract: ActContract<unknown>;
  props: unknown;
  /** Per PRD-303-R8 — instance handle for dedupe. */
  instance?: object;
  /** Optional binding-supplied (component name, source location) for placeholder metadata. */
  component?: string;
  location?: string;
}

/**
 * PRD-303-R10 — owns the per-render state. Construct one per (route,
 * variant) pass; never reuse across renders. The binding's `extractRoute`
 * creates a fresh instance per pass per PRD-303-R7 / R10 / R13.
 */
export class ActCollectorService {
  pageContract?: PageContract;
  variant?: string;
  /** PRD-303-R10 — render-order list of registrations. */
  collected: CollectedEntry[] = [];
  /**
   * PRD-303-R16 — counter incremented when a service or directive is
   * used outside any scope. The binding inspects this after render to
   * emit placeholders; we cannot throw inside the service registration
   * because that aborts the Angular render and prevents descendants
   * from contributing per PRD-303-R16's "render MUST continue past the
   * failed component."
   */
  outsideScopeCount = 0;
  /** PRD-303-R16 — captured render / lifecycle errors via `ErrorHandler`. */
  renderErrors: Array<{ error: Error; component?: string; location?: string }> = [];

  /**
   * PRD-303-R4 / R8 — registration entry point. Records the contract
   * against the collector's render-order list. Per PRD-303-R8 dedupe is
   * keyed on the (component class + instance) tuple supplied by the
   * caller; multiple `register` calls for the same instance produce ONE
   * entry (last-wins per PRD-300-R4).
   */
  register<P = unknown>(
    contract: ActContract<P>,
    props?: P,
    opts?: { instance?: object; component?: string; location?: string },
  ): void {
    const instance = opts?.instance;
    if (instance !== undefined) {
      // PRD-303-R8 — dedupe by instance.
      for (const e of this.collected) {
        if (e.instance === instance) {
          // Last-wins per PRD-300-R4.
          e.contract = contract as ActContract<unknown>;
          e.props = props;
          if (opts?.component !== undefined) e.component = opts.component;
          if (opts?.location !== undefined) e.location = opts.location;
          return;
        }
      }
    }
    const entry: CollectedEntry = {
      contract: contract as ActContract<unknown>,
      props,
    };
    if (instance !== undefined) entry.instance = instance;
    if (opts?.component !== undefined) entry.component = opts.component;
    if (opts?.location !== undefined) entry.location = opts.location;
    this.collected.push(entry);
  }

  /**
   * PRD-303-R5 / R11 — record the page-level contract. Throws
   * `AngularBindingError("PRD-303-R11")` when a page contract is already
   * set on this collector (nested `*actSection` per PRD-300-R13).
   */
  setPageContract(contract: PageContract): void {
    if (this.pageContract !== undefined) {
      throw new AngularBindingError(
        'PRD-303-R11',
        `*actSection nested inside another *actSection (PRD-300-R13); page "${contract.id}" cannot enclose page "${this.pageContract.id}"`,
      );
    }
    this.pageContract = contract;
  }

  /** PRD-303-R16 — capture an error caught by the binding's `ErrorHandler`. */
  recordError(err: unknown, component?: string, location?: string): void {
    const entry: { error: Error; component?: string; location?: string } = {
      error: err instanceof Error ? err : new Error(String(err)),
    };
    if (component !== undefined) entry.component = component;
    if (location !== undefined) entry.location = location;
    this.renderErrors.push(entry);
  }
}

/**
 * PRD-303-R4 — service-based declaration pattern. Components inject this
 * service and call `service.register(contract)` during construction. Per
 * PRD-303-R4 + R8, the service forwards registrations to the collector
 * (`extract` is NOT invoked here; the binding invokes it after SSR walk
 * completes via `aggregatePage`).
 *
 * The service is constructed with a reference to the active collector;
 * in an Angular app this is wired via `inject(ActCollectorService)` on
 * construction. Outside Angular (unit tests), the binding constructs the
 * service directly with a collector reference.
 */
export class ActContractService {
  constructor(private readonly collector: ActCollectorService | null) {}

  register<P = unknown>(
    contract: ActContract<P>,
    props?: P,
    opts?: { instance?: object; component?: string; location?: string },
  ): void {
    if (this.collector === null) {
      // PRD-303-R16 — service called outside an installed collector
      // scope. We cannot throw (would abort the render and prevent
      // descendants from contributing per PRD-303-R16); we surface via
      // the module-level fallback sentinel which the binding drains
      // after render.
      fallbackSentinel.outsideScopeCount += 1;
      fallbackSentinel.collected.push({
        contract: contract as ActContract<unknown>,
        props,
      });
      return;
    }
    this.collector.register(contract, props, opts);
  }
}

/**
 * PRD-303-R5 — `*actSection` structural directive lifecycle helper. The
 * directive's `ngOnInit` calls this with its bound contract and the
 * active collector; we centralize the page-contract registration logic
 * so the directive class itself stays a thin Angular wrapper.
 *
 * Per PRD-303-R11 nested page contracts throw via
 * `ActCollectorService.setPageContract`.
 */
export function applyActSection(
  collector: ActCollectorService | null,
  contract: PageContract,
): void {
  if (collector === null) {
    // PRD-303-R16 — directive used outside an installed collector scope.
    fallbackSentinel.outsideScopeCount += 1;
    return;
  }
  collector.setPageContract(contract);
}

/**
 * PRD-303-R7 — assert the collector is installed at the component-level
 * (per-render scope), not at root. The binding's `extractRoute`
 * enforces this by always constructing a fresh `ActCollectorService`
 * per render; manual installations should follow the same posture.
 *
 * Returns silently when `marker` indicates a component-local provider;
 * throws when `marker === "root"`. Generators pass `"root"` after
 * inspecting the route module's `providers` declaration.
 */
export function assertCollectorScopeIsComponentLocal(
  marker: 'component' | 'root',
): void {
  if (marker === 'root') {
    throw new AngularBindingError(
      'PRD-303-R7',
      'ActCollectorService MUST be installed at the component-level providers, not at root (PRD-303-R7); root-scoped providers leak per-render state across SSR runs',
    );
  }
}

/**
 * Module-level fallback sentinel. When a service or directive fires
 * outside any collector scope, the registration lands here. The binding
 * drains it before/after `extractRoute` (single-threaded SSR per pass)
 * — see PRD-303-R16.
 *
 * Concurrent renders (PRD-303-R20 `concurrent: true`) inside one worker
 * MUST go through `extractRoute`, which scopes via per-route
 * `ActCollectorService` and never relies on this sentinel for
 * correctness.
 */
export const fallbackSentinel: {
  collected: CollectedEntry[];
  outsideScopeCount: number;
} = {
  collected: [],
  outsideScopeCount: 0,
};

/** Reset the fallback sentinel (called by `extractRoute` between renders). */
export function _resetFallbackSentinel(): void {
  fallbackSentinel.collected = [];
  fallbackSentinel.outsideScopeCount = 0;
}
