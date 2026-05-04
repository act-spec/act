/**
 * PRD-301-R12 — React Server Components walk rule.
 *
 * The binding walks the SERVER tree only when RSC is in use. Client-only
 * components contribute via their static contract; `useActContract` calls
 * inside server components are a build error per PRD-301-R12 (the hook
 * relies on the React renderer, which behaves differently in the RSC
 * context).
 *
 * The actual `"use client"` boundary detection is a generator-side
 * responsibility (the generator owns module resolution); this module
 * provides the pure check the generator calls per discovered module.
 */
import { ReactBindingError } from './errors.js';

export interface RscModuleClassification {
  /** Source path (for the error message). */
  modulePath: string;
  /** True when the module begins with `"use client"` directive. */
  isClient: boolean;
  /** True when `useActContract` was detected in the module's source. */
  usesActContractHook: boolean;
}

/**
 * PRD-301-R12 — assert that `useActContract` is NOT used inside a server
 * component module. Throws `BuildError("PRD-301-R12")` on violation.
 *
 * Generators (PRD-405 Next.js App Router, PRD-406 Remix server actions)
 * call this once per discovered module after their RSC boundary scan.
 */
export function assertHookNotInServerComponent(
  cls: RscModuleClassification,
): void {
  if (!cls.isClient && cls.usesActContractHook) {
    throw new ReactBindingError(
      'PRD-301-R12',
      `useActContract called in server component "${cls.modulePath}" (PRD-300-R30); use the static field pattern in server components`,
    );
  }
}
