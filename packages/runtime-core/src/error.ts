/**
 * PRD-500-R17 / R18 error envelope construction.
 *
 * Single code path for every error outcome. The 404 path is the same byte
 * string for both `not_found` ("absent") and any 404 produced because the
 * principal cannot see the resource ("forbidden") — this is the
 * existence-non-leak rule (PRD-109-R3) and the source of `fixtures/500/positive/
 * core-existence-non-leak-symmetric-404.json`.
 */
import { ACT_VERSION } from '@act-spec/core';

import { buildAuthChallenges } from './auth.js';
import type { Manifest, Outcome } from './types.js';

/** PRD-500-R17 closed `error.code` enum (PRD-100-R41 / PRD-106-R27). */
export type ErrorCode =
  | 'auth_required'
  | 'not_found'
  | 'rate_limited'
  | 'validation'
  | 'internal';

/**
 * PRD-500-R17 default human-readable messages, code-keyed. The SDK MUST NOT
 * propagate free-form text from a resolver into `error.message` without
 * sanitization. Hosts MAY override via configuration in a future MINOR; for
 * v0.1 the defaults are the source of truth.
 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = Object.freeze({
  auth_required: 'Authentication required to access this resource.',
  not_found: 'The requested resource is not available.',
  rate_limited: 'Too many requests; retry after the indicated interval.',
  validation: 'The request was rejected by validation.',
  internal: 'An internal error occurred.',
});

/**
 * PRD-500-R17 — build an error envelope per PRD-100-R41 / PRD-106-R26.
 * `details` are propagated verbatim **only** from synthetic outcomes
 * (e.g., `{ kind: 'validation', details: { reason: 'depth_out_of_range' } }`);
 * resolver-supplied details for `internal` are dropped here per PRD-109-R14.
 */
export function buildErrorEnvelope(
  code: ErrorCode,
  details?: Record<string, unknown>,
): string {
  const env: { act_version: string; error: { code: ErrorCode; message: string; details?: Record<string, unknown> } } = {
    act_version: ACT_VERSION,
    error: { code, message: ERROR_MESSAGES[code] },
  };
  if (details && Object.keys(details).length > 0) {
    env.error.details = details;
  }
  return JSON.stringify(env);
}

/** Map an `Outcome` discriminator to its HTTP status code per PRD-500 §"Errors". */
export function statusForOutcome(
  outcome: Exclude<Outcome<unknown>, { kind: 'ok' }>,
): number {
  switch (outcome.kind) {
    case 'auth_required':
      return 401;
    case 'not_found':
      return 404;
    case 'rate_limited':
      return 429;
    case 'validation':
      return 400;
    case 'internal':
      return 500;
  }
}

/** Map an `Outcome` discriminator to its `error.code` value. */
export function codeForOutcome(
  outcome: Exclude<Outcome<unknown>, { kind: 'ok' }>,
): ErrorCode {
  return outcome.kind;
}

/**
 * PRD-500-R17 — build the response headers for an error outcome.
 *
 * For 401: appends one `WWW-Authenticate` per advertised scheme (PRD-500-R14).
 * For 429: sets `Retry-After`.
 * The `Content-Type` is always `application/act-error+json; profile=runtime`
 * (PRD-100-R46 + PRD-106 runtime profile).
 */
export function buildErrorHeaders(
  outcome: Exclude<Outcome<unknown>, { kind: 'ok' }>,
  manifest: Manifest,
): Headers {
  const headers = new Headers({
    'Content-Type': 'application/act-error+json; profile=runtime',
  });
  if (outcome.kind === 'auth_required') {
    for (const challenge of buildAuthChallenges(manifest)) {
      headers.append('WWW-Authenticate', challenge);
    }
  }
  if (outcome.kind === 'rate_limited') {
    headers.set('Retry-After', String(outcome.retryAfterSeconds));
  }
  return headers;
}
