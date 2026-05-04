/**
 * PRD-300-R28 / R29 / R30 / R31 — binding capability matrix utilities.
 *
 * Bindings publish a `BindingCapabilities` constant; generators (PRD-400)
 * read it to dispatch the extraction strategy. The framework offers:
 *  - `chooseExtractionMode` — preference-ordered dispatcher (R28).
 *  - `assertCapabilitiesShape` — strict-mode shape gate that catches
 *    bindings that publish a partial / wrong capability object.
 *  - `methodForMode` — the value the binding stamps as
 *    `metadata.extraction_method` per R29.
 */
import type { BindingCapabilities, ExtractionMethod, ExtractionMode } from './types.js';
import { BuildError } from './errors.js';

/** PRD-300-R28 — closed v0.1 capability key set. */
export const CAPABILITY_KEYS: ReadonlyArray<keyof BindingCapabilities> = [
  'ssr-walk',
  'static-ast',
  'headless-render',
  'rsc',
  'streaming',
  'suspense',
  'concurrent',
];

/**
 * PRD-300-R28 — verify the binding declared every flag with a boolean.
 * Throws on missing / wrong-type fields. Generators call this once at
 * startup before reading the dispatch.
 */
export function assertCapabilitiesShape(caps: unknown): asserts caps is BindingCapabilities {
  if (caps === null || typeof caps !== 'object') {
    throw new BuildError('PRD-300-R28', 'capabilities must be an object');
  }
  const obj = caps as Record<string, unknown>;
  for (const k of CAPABILITY_KEYS) {
    if (typeof obj[k] !== 'boolean') {
      throw new BuildError(
        'PRD-300-R28',
        `capabilities["${k}"] must be a boolean (got ${typeof obj[k]})`,
      );
    }
  }
}

/**
 * PRD-300-R28 / R29 / R30 — preference-ordered dispatcher. RSC + SSR
 * compose to `"rsc-ssr"`; otherwise the strongest declared mode wins.
 *
 * Returns the mode the generator should drive the binding with. Throws
 * `BuildError("PRD-300-R28")` when no usable mode is declared (the
 * binding is degenerate).
 */
export function chooseExtractionMode(caps: BindingCapabilities): ExtractionMode {
  if (caps.rsc && caps['ssr-walk']) return 'rsc-ssr';
  if (caps['ssr-walk']) return 'ssr-walk';
  if (caps['static-ast']) return 'static-ast';
  if (caps['headless-render']) return 'headless-render';
  throw new BuildError('PRD-300-R28', 'binding declares no usable extraction mode');
}

/**
 * PRD-300-R29 — value the binding stamps as `metadata.extraction_method`
 * for blocks emitted under a given mode. The mapping is identity for the
 * ssr/static/headless modes; the `rsc-ssr` composite reports as `rsc-ssr`.
 */
export function methodForMode(mode: ExtractionMode): ExtractionMethod {
  return mode;
}
