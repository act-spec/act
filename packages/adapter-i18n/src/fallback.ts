/**
 * PRD-207-R7 / R8 — node-level translation status + fallback-chain walk.
 *
 * v0.1 reports translation status at the *node* level using catalog
 * coverage of the keys that comprise the node. Per-key tracking is a v0.2
 * candidate (PRD-207 open question 1, resolved 2026-05-01).
 */
import type { FlatCatalog, TranslationStatus } from './types.js';

export interface NodeStatus {
  status: TranslationStatus;
  fallback_from?: string;
}

/**
 * PRD-207-R7 — given the keys associated with a node and the catalogs for
 * the requested locale + the configured fallback chain, compute the
 * node-level translation status.
 *
 *  - "complete" — every key is present in the requested locale's catalog.
 *  - "partial"  — some keys present in the requested locale, some absent.
 *  - "fallback" — no keys present in the requested locale, but the first
 *    fallback chain locale that has at least one of the keys is recorded
 *    in `fallback_from`.
 *  - "missing"  — no keys present in the requested locale OR any
 *    fallback chain locale (rare; PRD-207-R7 last bullet).
 *
 * The fallback chain MUST be passed as `[locale, F1, F2, ..., default]`;
 * the function ignores the leading `locale` entry per PRD-207-R8 step 2.
 */
export function determineNodeStatus(
  locale: string,
  nodeKeys: string[],
  catalogs: Map<string, FlatCatalog>,
  fallbackChain: string[],
): NodeStatus {
  if (nodeKeys.length === 0) {
    // Degenerate: no keys to evaluate. Treat as complete to avoid noise.
    return { status: 'complete' };
  }
  const requested = catalogs.get(locale);
  let presentInRequested = 0;
  if (requested) {
    for (const k of nodeKeys) if (requested.has(k)) presentInRequested += 1;
  }
  if (presentInRequested === nodeKeys.length) return { status: 'complete' };
  if (presentInRequested > 0) return { status: 'partial' };
  // Walk fallback chain looking for ANY presence of the node's keys.
  for (const f of fallbackChain) {
    if (f === locale) continue; // PRD-207-R8 step 2
    const cat = catalogs.get(f);
    if (!cat) continue;
    for (const k of nodeKeys) {
      if (cat.has(k)) return { status: 'fallback', fallback_from: f };
    }
  }
  return { status: 'missing' };
}
