/**
 * PRD-500-R17 — error envelope construction tests.
 */
import { describe, expect, it } from 'vitest';

import {
  ERROR_MESSAGES,
  buildErrorEnvelope,
  buildErrorHeaders,
  codeForOutcome,
  statusForOutcome,
} from './error.js';
import type { Manifest } from './types.js';

const baseManifest: Manifest = {
  act_version: '0.1',
  site: { name: 'errors.example' },
  delivery: 'runtime',
  conformance: { level: 'core' },
  index_url: '/i.json',
  node_url_template: '/n/{id}.json',
  auth: { schemes: ['bearer'] },
} as Manifest;

describe('PRD-500-R17: buildErrorEnvelope', () => {
  it('emits the closed code-keyed message', () => {
    const env = JSON.parse(buildErrorEnvelope('not_found')) as { error: { message: string } };
    expect(env.error.message).toBe(ERROR_MESSAGES.not_found);
  });

  it('includes act_version on every envelope per PRD-100-R1 / PRD-108-R1', () => {
    const env = JSON.parse(buildErrorEnvelope('internal')) as { act_version: string };
    expect(env.act_version).toBe('0.1');
  });

  it('omits details when not provided', () => {
    const env = JSON.parse(buildErrorEnvelope('internal')) as { error: { details?: unknown } };
    expect(env.error.details).toBeUndefined();
  });

  it('includes details when provided', () => {
    const env = JSON.parse(buildErrorEnvelope('validation', { reason: 'depth_out_of_range' })) as {
      error: { details: { reason: string } };
    };
    expect(env.error.details.reason).toBe('depth_out_of_range');
  });

  it('does not propagate empty details object', () => {
    const env = JSON.parse(buildErrorEnvelope('internal', {})) as { error: { details?: unknown } };
    expect(env.error.details).toBeUndefined();
  });
});

describe('PRD-500-R17: statusForOutcome / codeForOutcome', () => {
  it('maps each outcome kind to the correct HTTP status', () => {
    expect(statusForOutcome({ kind: 'auth_required' })).toBe(401);
    expect(statusForOutcome({ kind: 'not_found' })).toBe(404);
    expect(statusForOutcome({ kind: 'rate_limited', retryAfterSeconds: 5 })).toBe(429);
    expect(statusForOutcome({ kind: 'validation' })).toBe(400);
    expect(statusForOutcome({ kind: 'internal' })).toBe(500);
  });

  it('passes through the discriminator as the error.code', () => {
    expect(codeForOutcome({ kind: 'auth_required' })).toBe('auth_required');
    expect(codeForOutcome({ kind: 'not_found' })).toBe('not_found');
  });
});

describe('PRD-500-R17 / R14: buildErrorHeaders', () => {
  it('appends a WWW-Authenticate header per advertised scheme on 401', () => {
    const headers = buildErrorHeaders({ kind: 'auth_required' }, baseManifest);
    expect(headers.get('WWW-Authenticate')).toBe('Bearer realm="errors.example"');
  });

  it('sets Retry-After on 429', () => {
    const headers = buildErrorHeaders(
      { kind: 'rate_limited', retryAfterSeconds: 7 },
      baseManifest,
    );
    expect(headers.get('Retry-After')).toBe('7');
  });

  it('sets Content-Type to application/act-error+json; profile=runtime', () => {
    const headers = buildErrorHeaders({ kind: 'not_found' }, baseManifest);
    expect(headers.get('Content-Type')).toBe('application/act-error+json; profile=runtime');
  });

  it('does not set WWW-Authenticate on non-401 errors', () => {
    const headers = buildErrorHeaders({ kind: 'not_found' }, baseManifest);
    expect(headers.get('WWW-Authenticate')).toBeNull();
  });
});
