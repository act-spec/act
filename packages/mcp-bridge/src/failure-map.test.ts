/**
 * PRD-602-R14 / PRD-500-R18 outcome → MCP error mapping tests.
 *
 * The mapping preserves byte-equivalence between `not_found` and any
 * existence-leaking branch (the leaf SDK already collapses `denied` →
 * `not_found` per PRD-500-R18; the bridge MUST NOT add fields that
 * distinguish the two on the MCP side).
 */
import { describe, expect, it } from 'vitest';

import {
  NOT_FOUND_MESSAGE,
  checkUnknownRequiredField,
  mapOutcomeToMcpError,
} from './failure-map.js';

describe('PRD-602-R14: mapOutcomeToMcpError', () => {
  const fixedId = '00000000-0000-0000-0000-000000000001';

  it('maps not_found → RESOURCE_NOT_FOUND with canonical message', () => {
    const err = mapOutcomeToMcpError({ kind: 'not_found' }, { requestId: fixedId });
    expect(err).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      message: NOT_FOUND_MESSAGE,
      data: { request_id: fixedId },
    });
  });

  it('maps auth_required → AUTHENTICATION_REQUIRED with WWW-Authenticate hint when supplied', () => {
    const err = mapOutcomeToMcpError(
      { kind: 'auth_required' },
      { requestId: fixedId, challenge: 'Bearer realm="docs"' },
    );
    expect(err.code).toBe('AUTHENTICATION_REQUIRED');
    expect(err.data.hint).toBe('Bearer realm="docs"');
  });

  it('maps auth_required without hint when no challenge supplied', () => {
    const err = mapOutcomeToMcpError({ kind: 'auth_required' }, { requestId: fixedId });
    expect(err.data.hint).toBeUndefined();
  });

  it('maps validation → INVALID_REQUEST with details propagated', () => {
    const err = mapOutcomeToMcpError(
      { kind: 'validation', details: { field: 'depth', reason: 'out of range' } },
      { requestId: fixedId },
    );
    expect(err.code).toBe('INVALID_REQUEST');
    expect(err.data.details).toEqual({ field: 'depth', reason: 'out of range' });
  });

  it('maps validation → INVALID_REQUEST without details when omitted', () => {
    const err = mapOutcomeToMcpError({ kind: 'validation' }, { requestId: fixedId });
    expect(err.code).toBe('INVALID_REQUEST');
    expect(err.data.details).toBeUndefined();
  });

  it('maps rate_limited → INTERNAL_ERROR carrying retry_after_seconds', () => {
    const err = mapOutcomeToMcpError(
      { kind: 'rate_limited', retryAfterSeconds: 30 },
      { requestId: fixedId },
    );
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.data.details).toEqual({ retry_after_seconds: 30 });
  });

  it('maps internal → INTERNAL_ERROR with no leaked details', () => {
    const err = mapOutcomeToMcpError({ kind: 'internal', details: { stack: 'leaked!' } }, {
      requestId: fixedId,
    });
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.data.details).toBeUndefined();
  });

  it('PRD-500-R18 byte-equivalence: not_found and a hypothetical denied collapse to identical envelopes', () => {
    // The leaf SDK collapses denied → not_found. The bridge MUST surface
    // both as identical envelopes (modulo opaque request_id).
    const a = mapOutcomeToMcpError({ kind: 'not_found' }, { requestId: 'A' });
    const b = mapOutcomeToMcpError({ kind: 'not_found' }, { requestId: 'B' });
    const stripId = (e: { data: { request_id: string } }): unknown => ({
      ...e,
      data: { ...e.data, request_id: '<opaque>' },
    });
    expect(stripId(a)).toEqual(stripId(b));
  });

  it('generates a UUIDv4 request_id when none supplied', () => {
    const err = mapOutcomeToMcpError({ kind: 'not_found' });
    expect(err.data.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('PRD-602-R19: checkUnknownRequiredField', () => {
  it('admits frames with no required-marker keys', () => {
    expect(checkUnknownRequiredField({ a: 1, b: 'two' }, new Set())).toEqual({ rejected: false });
  });

  it('admits a known required-marker key when in the admit list', () => {
    expect(
      checkUnknownRequiredField(
        { 'required:knownField': true },
        new Set(['required:knownField']),
      ),
    ).toEqual({ rejected: false });
  });

  it('rejects an unknown required-marker key (REQUIRED-field tolerance violation)', () => {
    const result = checkUnknownRequiredField(
      { 'required:newMcpFeature': true },
      new Set(),
    );
    expect(result).toEqual({ rejected: true, field: 'required:newMcpFeature' });
  });
});
