/**
 * PRD-705-R15 — Logger that respects PRD-109-R14 / R15 (no PII).
 *
 * The SDK enforces the no-PII shape on its side (the events are typed
 * structurally and never carry node bodies, cookie values, or tokens). The
 * example only opts into the discriminated event stream; all output goes to
 * stderr at info level. A real deployment would substitute pino / winston.
 */
import type { Logger } from '@act-spec/runtime-core';

export const logger: Logger = {
  event(e) {
    // eslint-disable-next-line no-console
    console.error(`[act] ${e.type} ${JSON.stringify(redact(e))}`);
  },
};

/**
 * Defensive redaction belt-and-suspenders. The SDK already strips PII at
 * its boundary; we re-strip the small subset of fields that could carry
 * application identifiers we're being conservative about (none today, but
 * the hook is here for future event additions per PRD-108-R7 tolerance).
 */
function redact(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'type') continue;
    out[k] = v;
  }
  return out;
}
