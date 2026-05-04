/**
 * PRD-706-R18 / PRD-602-R18 — correlated logger. Inherits PRD-705-R15's
 * no-PII contract. Real deployments substitute pino / winston.
 */
import type { Logger } from '@act-spec/runtime-core';

export const logger: Logger = {
  event(e) {
    // eslint-disable-next-line no-console
    console.error(`[act/app] ${e.type} ${JSON.stringify(stripType(e))}`);
  },
};

function stripType(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'type') continue;
    out[k] = v;
  }
  return out;
}
