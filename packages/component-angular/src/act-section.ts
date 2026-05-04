/**
 * PRD-303-R5 — `*actSection` structural directive + `<act-section>`
 * component form for page-level boundaries.
 *
 * Per PRD-303 Open Question 1 (resolved 2026-05-01) we ship BOTH:
 *  - the structural directive form (`*actSection="contract"`) — preferred
 *    for in-template page boundaries on routed components;
 *  - the component form (`<act-section [contract]="...">`) — preferred
 *    for layout components that wrap routed content.
 *
 * Both forms desugar through the same `applyActSection` helper in
 * `collector.ts`, so output is byte-identical per PRD-303-R6.
 *
 * The classes below are framework-agnostic by design (per A15
 * truthfulness posture): they implement the Angular `OnInit` lifecycle
 * by signature and are decorated by the consumer's Angular compiler when
 * imported into a standalone component's `imports: []` array. The
 * binding does not import `@angular/core` at runtime so it can be
 * consumed without forcing the Angular dependency in environments that
 * only need the contract surface (PRD-303-R2 makes Angular a peer dep).
 *
 * Authors decorating these classes in their own app:
 *
 *   ```ts
 *   import { Directive, Input, inject } from '@angular/core';
 *   import { ActSectionDirective as Base, ActCollectorService } from '@act-spec/component-angular';
 *
 *   @Directive({ selector: '[actSection]', standalone: true })
 *   export class ActSectionDirective extends Base {
 *     @Input('actSection') override contract!: PageContract;
 *     constructor() { super(inject(ActCollectorService, { optional: true })); }
 *   }
 *   ```
 *
 * In v0.1 the binding ships the base classes; future minor versions
 * MAY ship Angular-decorated wrappers as a sub-export once Angular is
 * a hard dependency.
 */
import type { PageContract } from '@act-spec/component-contract';
import { applyActSection, type ActCollectorService } from './collector.js';

/**
 * PRD-303-R5 — base class for the `*actSection` structural directive.
 * Implements Angular's `OnInit` interface by signature: `ngOnInit()`
 * registers the bound contract on the active collector via
 * `applyActSection`.
 *
 * Consumers extend this class with `@Directive({ selector: '[actSection]', ... })`
 * and use `@Input('actSection')` to bind the contract.
 */
export class ActSectionDirective {
  /** PRD-303-R5 — bound by `*actSection="..."`; consumer-side `@Input`. */
  contract!: PageContract;

  constructor(protected readonly collector: ActCollectorService | null) {}

  /**
   * PRD-303-R5 — Angular `OnInit` lifecycle: register the page
   * contract on the active collector. Per PRD-303-R11 nested
   * `*actSection` throws via `applyActSection` →
   * `ActCollectorService.setPageContract`.
   */
  ngOnInit(): void {
    applyActSection(this.collector, this.contract);
  }
}

/**
 * PRD-303-R5 — base class for the `<act-section>` component form. Same
 * lifecycle semantics as the structural directive; the only difference
 * is template ergonomics (the component wraps `<ng-content>` so layout
 * components can use it as a wrapping element).
 *
 * Consumers extend this class with `@Component({ selector: 'act-section', standalone: true, template: '<ng-content></ng-content>', ... })`
 * and use `@Input() contract!: PageContract` to bind the contract.
 */
export class ActSectionComponent {
  /** PRD-303-R5 — bound by `[contract]="..."`; consumer-side `@Input`. */
  contract!: PageContract;

  constructor(protected readonly collector: ActCollectorService | null) {}

  /** PRD-303-R5 — same lifecycle semantics as the structural directive. */
  ngOnInit(): void {
    applyActSection(this.collector, this.contract);
  }
}
