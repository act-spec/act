/**
 * Public-surface smoke test for `@act-spec/mcp-bridge`. Confirms the
 * exports listed in `src/index.ts` exist and have the correct shape.
 */
import { describe, expect, it } from 'vitest';

import * as api from './index.js';

describe('@act-spec/mcp-bridge public surface', () => {
  it('exports createActMcpBridge and createBridge alias (PRD-602-R2)', () => {
    expect(typeof api.createActMcpBridge).toBe('function');
    expect(typeof api.createBridge).toBe('function');
    expect(api.createBridge).toBe(api.createActMcpBridge);
  });

  it('exports BridgeConfigurationError (PRD-602-R3 / R24 / R25)', () => {
    expect(typeof api.BridgeConfigurationError).toBe('function');
  });

  it('exports URI helpers (PRD-602-R6 / R7 / R11)', () => {
    expect(typeof api.buildResourceUri).toBe('function');
    expect(typeof api.buildManifestUri).toBe('function');
    expect(typeof api.buildSubtreeUri).toBe('function');
    expect(typeof api.encodePrefixSegments).toBe('function');
    expect(typeof api.isValidMcpHost).toBe('function');
    expect(typeof api.resolveMountByPath).toBe('function');
    expect(api.MANIFEST_RESOURCE_ID).toBe('manifest');
  });

  it('exports failure-mapping helpers (PRD-602-R14 / R19)', () => {
    expect(typeof api.mapOutcomeToMcpError).toBe('function');
    expect(typeof api.checkUnknownRequiredField).toBe('function');
    expect(api.NOT_FOUND_MESSAGE).toBe('Resource not found.');
  });

  it('exports static-source reader (PRD-602-R24 / PRD-706-R13)', () => {
    expect(typeof api.readStaticSource).toBe('function');
  });

  it('exports MCP enumeration probe harness (PRD-706 acceptance criterion (e))', () => {
    expect(typeof api.runMcpEnumerationProbe).toBe('function');
  });

  it('exposes the package name constant', () => {
    expect(api.MCP_BRIDGE_PACKAGE_NAME).toBe('@act-spec/mcp-bridge');
  });
});
