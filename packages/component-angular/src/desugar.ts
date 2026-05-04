/**
 * PRD-303-R3 / R6 — Angular declaration patterns desugared through
 * `@act-spec/component-contract`'s `fromStaticField` helper.
 *
 * Pattern 1 — static field on the component class (`HeroComponent.act`).
 * Pattern 2 — service registration (`ActContractService.register`),
 *             handled in `collector.ts`.
 * Pattern 3 — structural directive (`*actSection="contract"`),
 *             handled in `act-section.ts`.
 *
 * Per PRD-303-R6 all four declaration surfaces (component static field,
 * service `register()` call, structural directive, component form) MUST
 * desugar to the same internal `ActContract<P>` shape and pass through
 * the same internal traversal. Output across the surface forms MUST be
 * byte-identical given identical authored inputs.
 */
import type { ActContract } from '@act-spec/component-contract';
import { fromStaticField } from '@act-spec/component-contract';
import type { AngularComponentWithAct } from './types.js';

/**
 * PRD-303-R3 — pull the `static act` member off an Angular component
 * class. The static field survives Angular's Ivy compilation pipeline
 * including tree-shaking transformations.
 */
export function pickStaticContract<P>(
  comp: AngularComponentWithAct<P> | null | undefined,
): ActContract<P> | undefined {
  return fromStaticField(comp);
}
