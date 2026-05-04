/**
 * PRD-505-R1 / R2 — surface check. The package's public API MUST be
 * structurally compatible with the PRD-505 signatures and re-export the
 * runtime-core types per non-goal #1.
 */
import { describe, expect, it } from 'vitest';

import * as fetchSdk from './index.js';

describe('@act-spec/runtime-fetch public surface', () => {
  it('exports the package name constant', () => {
    expect(fetchSdk.RUNTIME_FETCH_PACKAGE_NAME).toBe('@act-spec/runtime-fetch');
  });

  it('exports createActFetchHandler as a function', () => {
    expect(typeof fetchSdk.createActFetchHandler).toBe('function');
  });

  it('re-exports runtime-core helpers (ConfigurationError, defaultEtagComputer)', () => {
    expect(typeof fetchSdk.ConfigurationError).toBe('function');
    expect(typeof fetchSdk.defaultEtagComputer).toBe('function');
  });

  it('exports the request / response / route helpers for advanced hosts', () => {
    expect(typeof fetchSdk.fromFetchRequest).toBe('function');
    expect(typeof fetchSdk.toFetchResponse).toBe('function');
    expect(typeof fetchSdk.buildRouteTable).toBe('function');
    expect(typeof fetchSdk.matchesActEndpoint).toBe('function');
    expect(typeof fetchSdk.matchesTemplatePath).toBe('function');
    expect(typeof fetchSdk.parseCookieHeader).toBe('function');
  });
});
