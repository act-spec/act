/**
 * Construction-time validation tests covering PRD-602-R3, PRD-602-R24,
 * PRD-602-R25, and the PRD-602 Security §"URI scheme injection" check.
 *
 * The bridge MUST NOT serve a partially-valid configuration: every
 * failure throws at `createBridge` before any request is dispatched
 * (PRD-602-R3 paragraph 3).
 */
import { describe, expect, it } from 'vitest';

import { coreManifest, standardManifest, makeRuntime } from './_fixtures.js';
import {
  BridgeConfigurationError,
  validateBridgeConfig,
} from './validate-config.js';
import type { BridgeConfig } from './types.js';

describe('PRD-602 Security: validateBridgeConfig host check', () => {
  it('rejects empty mcp.host (URI scheme injection guard)', () => {
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: '' },
    };
    expect(() => validateBridgeConfig(config)).toThrowError(BridgeConfigurationError);
  });

  it('rejects mcp.host with reserved characters', () => {
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'h/path' },
    };
    try {
      validateBridgeConfig(config);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeConfigurationError);
      expect((err as BridgeConfigurationError).code).toBe('INVALID_HOST');
    }
  });
});

describe('PRD-602-R3 single-source: passes for valid Core runtime', () => {
  it('does not throw for a Core runtime with valid host', () => {
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'docs.example.com' },
    };
    expect(() => validateBridgeConfig(config)).not.toThrow();
  });
});

describe('PRD-602-R3 multi-mount: per-mount level validation', () => {
  it('rejects a runtime mount declaring level=standard but missing resolveSubtree (PRD-500-R32)', () => {
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'h' },
      mounts: [
        {
          prefix: '/app',
          source: makeRuntime({ subtree: false }),
          manifest: standardManifest(),
        },
      ],
    };
    expect(() => validateBridgeConfig(config)).toThrowError(/level=standard.*resolveSubtree/);
  });

  it('accepts a runtime mount declaring level=standard with resolveSubtree', () => {
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: true }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'h' },
      mounts: [
        {
          prefix: '/app',
          source: makeRuntime({ subtree: true }),
          manifest: standardManifest(),
        },
      ],
    };
    expect(() => validateBridgeConfig(config)).not.toThrow();
  });

  it('accepts a static mount declaring level=core (admit-list check on the manifest)', () => {
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'h' },
      mounts: [
        {
          prefix: '/marketing',
          source: { kind: 'static', manifestUrl: 'https://m/.well-known/act.json' },
          manifest: coreManifest(),
        },
      ],
    };
    expect(() => validateBridgeConfig(config)).not.toThrow();
  });

  it('rejects a static mount declaring level=standard but missing subtree_url_template (PRD-107-R8)', () => {
    const m = coreManifest();
    m.conformance = { level: 'standard' };
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'h' },
      mounts: [
        {
          prefix: '/marketing',
          source: { kind: 'static', manifestUrl: 'https://m/.well-known/act.json' },
          manifest: m,
        },
      ],
    };
    expect(() => validateBridgeConfig(config)).toThrowError(/subtree_url_template/);
  });
});

describe('PRD-602-R24 / PRD-106-R20 mount prefix coherence', () => {
  it('rejects overlapping prefixes', () => {
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'h' },
      mounts: [
        {
          prefix: '/docs',
          source: { kind: 'static', manifestUrl: 'https://m/.well-known/act.json' },
          manifest: coreManifest(),
        },
        {
          prefix: '/docs/v2',
          source: { kind: 'static', manifestUrl: 'https://m2/.well-known/act.json' },
          manifest: coreManifest(),
        },
      ],
    };
    try {
      validateBridgeConfig(config);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeConfigurationError);
      expect((err as BridgeConfigurationError).code).toBe('OVERLAPPING_PREFIXES');
    }
  });

  it('rejects empty mounts array (use single-source path instead)', () => {
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'h' },
      mounts: [],
    };
    expect(() => validateBridgeConfig(config)).toThrowError(/at least one mount/);
  });

  it('rejects mount prefix without leading slash', () => {
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'h' },
      mounts: [
        {
          prefix: 'app',
          source: makeRuntime({ subtree: false }),
          manifest: coreManifest(),
        },
      ],
    };
    expect(() => validateBridgeConfig(config)).toThrowError(/MUST start with "\/"/);
  });
});

describe('PRD-602-R25 act_version pinning', () => {
  it('rejects a mount manifest with act_version != "0.1"', () => {
    const m = coreManifest();
    m.act_version = '0.2';
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'h' },
      mounts: [
        {
          prefix: '/app',
          source: { kind: 'static', manifestUrl: 'https://m/.well-known/act.json' },
          manifest: m,
        },
      ],
    };
    try {
      validateBridgeConfig(config);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeConfigurationError);
      expect((err as BridgeConfigurationError).code).toBe('ACT_VERSION_MISMATCH');
    }
  });

  it('honors a custom actVersion override', () => {
    const m = coreManifest();
    m.act_version = '0.2';
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'h' },
      actVersion: '0.2',
      mounts: [
        {
          prefix: '/app',
          source: { kind: 'static', manifestUrl: 'https://m/.well-known/act.json' },
          manifest: m,
        },
      ],
    };
    expect(() => validateBridgeConfig(config)).not.toThrow();
  });
});

describe('PRD-602-R10 per-mount IdentityBridge requirement', () => {
  it('rejects a runtime mount with identityResolver but no identityBridge', () => {
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: true }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'h' },
      mounts: [
        {
          prefix: '/app',
          source: makeRuntime({ subtree: true }),
          manifest: standardManifest(),
          identityResolver: async () => ({ kind: 'auth_required' }),
        },
      ],
    };
    try {
      validateBridgeConfig(config);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BridgeConfigurationError);
      expect((err as BridgeConfigurationError).code).toBe('MISSING_IDENTITY_BRIDGE');
    }
  });

  it('accepts a static mount with no identityBridge (anonymous-readable per PRD-602-R10)', () => {
    const config: BridgeConfig = {
      runtime: makeRuntime({ subtree: false }),
      httpHandler: async () => null,
      mcp: { name: 'n', version: '1', host: 'h' },
      mounts: [
        {
          prefix: '/marketing',
          source: { kind: 'static', manifestUrl: 'https://m/.well-known/act.json' },
          manifest: coreManifest(),
        },
      ],
    };
    expect(() => validateBridgeConfig(config)).not.toThrow();
  });
});
