/**
 * PRD-602-R14 — ACT outcome → MCP error mapping.
 *
 * Per PRD-500-R18 the leaf SDK already collapses `denied` (forbidden)
 * into `not_found` for cross-tenant non-disclosure (PRD-109-R3 / R11 /
 * R13). The bridge therefore receives only the kinds enumerated in
 * `Outcome` (PRD-500-R4): `not_found`, `auth_required`, `rate_limited`,
 * `validation`, `internal`. The mapping table:
 *
 *   not_found     → MCP RESOURCE_NOT_FOUND
 *   auth_required → MCP AUTHENTICATION_REQUIRED (with WWW-Authenticate hint)
 *   rate_limited  → MCP INTERNAL_ERROR (no MCP rate-limit code in 1.0)
 *   validation    → MCP INVALID_REQUEST
 *   internal      → MCP INTERNAL_ERROR
 *
 * The bridge MUST NOT add MCP-side fields that distinguish a `not_found`
 * from a (collapsed) `denied` — the leaf SDK already collapsed them, so
 * this is a pass-through guarantee.
 */
import { randomUUID } from 'node:crypto';

import type { Outcome } from '@act-spec/runtime-core';

/**
 * MCP error envelope shape per PRD-602-R14. The `code` is a stable string
 * identifier the bridge surfaces in the JSON-RPC error object's `data`
 * field (the MCP SDK's `McpError` carries a numeric `code`; the bridge
 * supplies our string code under `data.act_error_code` so MCP clients can
 * dispatch on it without coupling to the SDK's numeric mapping).
 */
export interface BridgeMcpError {
  readonly code: BridgeMcpErrorCode;
  readonly message: string;
  readonly data: {
    readonly request_id: string;
    readonly hint?: string;
    readonly details?: Record<string, unknown>;
  };
}

export type BridgeMcpErrorCode =
  | 'RESOURCE_NOT_FOUND'
  | 'AUTHENTICATION_REQUIRED'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN_REQUIRED_FIELD';

/** Canonical not-found message — used for both `not_found` and any other
 * existence-leaking branch the leaf SDK might return. Byte-equivalent
 * across all callers per PRD-602-R14 / PRD-500-R18.
 */
export const NOT_FOUND_MESSAGE = 'Resource not found.';

export interface MapOutcomeOptions {
  /** Optional WWW-Authenticate-derived challenge for `auth_required`. */
  readonly challenge?: string;
  /** Override the request_id (deterministic tests); defaults to a UUIDv4. */
  readonly requestId?: string;
}

/**
 * Map an ACT `Outcome<T>` to a MCP-side error envelope. Only error
 * kinds are mapped; `ok` is the caller's responsibility (the bridge
 * delivers the body directly).
 */
export function mapOutcomeToMcpError(
  outcome: Exclude<Outcome<unknown>, { kind: 'ok' }>,
  opts: MapOutcomeOptions = {},
): BridgeMcpError {
  const requestId = opts.requestId ?? randomUUID();
  switch (outcome.kind) {
    case 'not_found':
      return {
        code: 'RESOURCE_NOT_FOUND',
        message: NOT_FOUND_MESSAGE,
        data: { request_id: requestId },
      };
    case 'auth_required':
      return {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required.',
        data: opts.challenge
          ? { request_id: requestId, hint: opts.challenge }
          : { request_id: requestId },
      };
    case 'validation':
      return {
        code: 'INVALID_REQUEST',
        message: 'Invalid request.',
        data: outcome.details
          ? { request_id: requestId, details: outcome.details }
          : { request_id: requestId },
      };
    case 'rate_limited':
      return {
        code: 'INTERNAL_ERROR',
        message: 'Rate limited.',
        data: { request_id: requestId, details: { retry_after_seconds: outcome.retryAfterSeconds } },
      };
    case 'internal':
      return {
        code: 'INTERNAL_ERROR',
        message: 'Internal error.',
        data: { request_id: requestId },
      };
  }
}

/**
 * PRD-602-R19 — incoming MCP frame with an unknown REQUIRED field MUST
 * be rejected with `UNKNOWN_REQUIRED_FIELD` and the field name
 * surfaced to the operator's logger. The bridge tolerates unknown
 * OPTIONAL fields per the same R19 ("tolerates" list).
 *
 * We use an admit-list of REQUIRED field names per MCP 1.0 + a per-method
 * required-fields map. `params` is the MCP request frame's `params`
 * object. `requiredKeysAdmit` enumerates the keys the bridge knows about;
 * any key whose name starts with `required:` (a synthetic marker some
 * MCP transports use for fields the spec marks REQUIRED) and is not in
 * the admit list triggers the rejection.
 *
 * In practice we cannot detect "REQUIRED" purely from the frame (the
 * spec is the schema, not the wire). The implementation here gives
 * operators a hook: callers pass the set of admitted REQUIRED field
 * names per the published shim; unknown REQUIRED fields rejected.
 */
export function checkUnknownRequiredField(
  frame: Record<string, unknown>,
  admittedRequiredKeys: ReadonlySet<string>,
): { rejected: false } | { rejected: true; field: string } {
  for (const key of Object.keys(frame)) {
    if (key.startsWith('required:') && !admittedRequiredKeys.has(key)) {
      return { rejected: true, field: key };
    }
  }
  return { rejected: false };
}
