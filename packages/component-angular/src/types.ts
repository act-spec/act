/**
 * PRD-303 Angular-binding type surface.
 *
 * Mirrors PRD-303 §"Wire format / interface definition" §"Angular-specific
 * declaration types". Angular types (`Type<T>`, `EnvironmentInjector`,
 * `ApplicationRef`, `ErrorHandler`) are referenced via the
 * `peerDependencies`-installed `@angular/core` package; consumers MUST
 * provide `@angular/core` (and `@angular/platform-server`) at install time
 * per PRD-303-R2.
 *
 * Per A15 (capability-table truthfulness, applied symmetrically): the
 * binding does not import `@angular/core` types directly so it can be
 * consumed without forcing the Angular dependency in environments that
 * only need the contract surface (e.g., a tree-shaking generator that
 * imports only the capability matrix). The few Angular shapes the
 * binding's surface mentions are encoded as structural aliases below;
 * generators that pass real Angular types satisfy them by structure.
 *
 * The contract object shape is owned by `@act-spec/component-contract`
 * (PRD-300-R2). This file only pins Angular-specific declaration shapes.
 */
import type { ActContract, PageContract } from '@act-spec/component-contract';

/**
 * Structural alias for Angular's `Type<T>` (a class constructor).
 * `@angular/core` exports `Type<T> = abstract new (...args: unknown[]) => T`;
 * we reproduce the structural shape here so the binding's types do not
 * import `@angular/core` directly. Generators passing real `Type<T>`
 * values satisfy the alias by structure.
 */
export type AngularType<T> = abstract new (...args: never[]) => T;

/**
 * PRD-303-R3 — static-field declaration pattern. An Angular component
 * class carries a `static act` member whose value is an `ActContract<P>`
 * per PRD-300-R2. The static field survives Angular's Ivy compilation
 * pipeline including tree-shaking transformations.
 *
 * Example:
 *   `@Component({...}) class HeroComponent { static act = {...}; }`
 */
export type AngularComponentWithAct<P> = AngularType<unknown> & {
  act?: ActContract<P>;
};

/**
 * PRD-303-R5 — page-level boundary inputs. The structural directive
 * (`*actSection="contract"`) and the `<act-section [contract]="...">`
 * component form both bind to a `PageContract` per PRD-300.
 */
export interface ActSectionInputs {
  /** PRD-303-R5 — the page contract bound by the directive / component. */
  contract: PageContract;
}

/**
 * PRD-303-R22 — input the generator hands `extractRoute`. The framework
 * `ExtractRouteInput` (PRD-300) carries a generic `module: unknown`; the
 * Angular-specific shape narrows it.
 *
 * `module` is the route's bootstrap component (standalone form per
 * PRD-303-R22) or — for legacy NgModule apps (PRD-303 Open Question 3) —
 * the route's `NgModule` reference. The binding's `extractRoute` uses
 * `module` as the root component for `renderApplication`.
 *
 * `pageContract` is read from the route module's `static act` field
 * (PRD-303-R5) when not supplied; generators MAY pre-resolve it.
 */
export interface AngularExtractRouteInput {
  /** PRD-300-R10 — page-level id. */
  routeId: string;
  /** PRD-303-R22 — the route's bootstrap component (or NgModule). */
  module: AngularComponentWithAct<unknown>;
  /** PRD-303-R5 — page contract resolved from the route module. */
  pageContract: PageContract;
  /** PRD-300-R32 — build-time-resolved props. */
  routeProps?: unknown;
  /** PRD-104. */
  locale?: string | undefined;
  /** PRD-300-R18 — variant-source declaration when `variants` are emitted. */
  variantSource?: 'experiment' | 'personalization' | 'locale';
}
