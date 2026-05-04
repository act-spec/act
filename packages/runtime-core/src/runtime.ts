/**
 * PRD-500-R10 — `createActRuntime(config)` performs construction-time
 * capability negotiation. The function MUST validate the resolver set and
 * the manifest's `auth` declaration synchronously before returning a
 * dispatchable instance. Mismatches throw a `ConfigurationError`; hosts
 * never see request-time level mismatches.
 */
import { dispatch } from './dispatch.js';
import { defaultEtagComputer } from './etag.js';
import type {
  ActRequest,
  ActResponse,
  ActRuntime,
  ActRuntimeConfig,
  ActRuntimeInstance,
  Logger,
  Manifest,
  TenantResolver,
} from './types.js';

/** Construction-time error raised by `createActRuntime`. PRD-500-R10. */
export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
  constructor(message: string) {
    super(message);
  }
}

const NOOP_LOGGER: Logger = { event: () => {} };
const DEFAULT_TENANT_RESOLVER: TenantResolver = () => Promise.resolve({ kind: 'single' });

function ensureManifestPRD500R8(manifest: Manifest): Manifest {
  // PRD-500-R8 — SDK MUST inject `act_version` and `delivery: "runtime"` if
  // omitted; SDK MUST NOT silently overwrite a host-supplied
  // `delivery: "static"` (mismatch is a configuration error).
  const next: Manifest = { ...manifest };
  if (!next.act_version) next.act_version = '0.1';
  if (!next.delivery) next.delivery = 'runtime';
  if (next.delivery !== 'runtime') {
    throw new ConfigurationError(
      `PRD-500-R8: manifest.delivery is "${next.delivery}"; runtime SDK requires "runtime".`,
    );
  }
  return next;
}

function validateCapabilityNegotiation(
  manifest: Manifest,
  runtime: ActRuntime,
): void {
  const level = manifest.conformance.level;

  // PRD-500-R10 — Core minimum.
  for (const fn of ['resolveManifest', 'resolveIndex', 'resolveNode'] as const) {
    if (typeof runtime[fn] !== 'function') {
      throw new ConfigurationError(
        `PRD-500-R10: ${fn} is required for level "${level}" but was not registered.`,
      );
    }
  }

  if (level === 'standard' || level === 'strict') {
    if (typeof runtime.resolveSubtree !== 'function') {
      throw new ConfigurationError(
        `PRD-500-R10 / R32: resolveSubtree is required for level "${level}" but was not registered.`,
      );
    }
    if (!manifest.subtree_url_template) {
      throw new ConfigurationError(
        `PRD-500-R10: manifest.subtree_url_template is required for level "${level}".`,
      );
    }
  }
  if (level === 'strict') {
    if (typeof runtime.resolveIndexNdjson !== 'function') {
      throw new ConfigurationError(
        'PRD-500-R10 / R33: resolveIndexNdjson is required for level "strict" but was not registered.',
      );
    }
    if (typeof runtime.resolveSearch !== 'function') {
      throw new ConfigurationError(
        'PRD-500-R10 / R34: resolveSearch is required for level "strict" but was not registered.',
      );
    }
    if (!manifest.index_ndjson_url) {
      throw new ConfigurationError(
        'PRD-500-R10: manifest.index_ndjson_url is required for level "strict".',
      );
    }
    if (!manifest.search_url_template) {
      throw new ConfigurationError(
        'PRD-500-R10: manifest.search_url_template is required for level "strict".',
      );
    }
  }

  // PRD-500-R9 — capability advertisement MUST NOT under-declare. We do not
  // forbid array-form here (the codegen'd Manifest type already rejects it
  // structurally); the runtime check is on declared-vs-registered.
  const caps = manifest.capabilities ?? {};
  if (caps.subtree === true && typeof runtime.resolveSubtree !== 'function') {
    throw new ConfigurationError(
      'PRD-500-R9: capabilities.subtree=true but resolveSubtree was not registered.',
    );
  }
  if (caps.ndjson_index === true && typeof runtime.resolveIndexNdjson !== 'function') {
    throw new ConfigurationError(
      'PRD-500-R9: capabilities.ndjson_index=true but resolveIndexNdjson was not registered.',
    );
  }

  // PRD-500-R10 second paragraph — auth.oauth2 fields when "oauth2" advertised.
  const auth = manifest.auth as
    | { schemes?: ReadonlyArray<string>; oauth2?: { authorization_endpoint?: string; token_endpoint?: string; scopes_supported?: ReadonlyArray<string> } }
    | undefined;
  if (auth?.schemes?.includes('oauth2')) {
    const o = auth.oauth2;
    if (!o || !o.authorization_endpoint || !o.token_endpoint || !o.scopes_supported || o.scopes_supported.length === 0) {
      throw new ConfigurationError(
        'PRD-500-R10: auth.schemes includes "oauth2" but oauth2.{authorization_endpoint, token_endpoint, scopes_supported} are not all present.',
      );
    }
  }
}

/**
 * PRD-500-R10 + §"Construction & dispatch" — build a runtime instance.
 *
 * Throws `ConfigurationError` synchronously on capability negotiation
 * mismatches, oauth2 misdeclaration, or `delivery` conflict. After successful
 * construction, leaf adapters call `instance.dispatch(actRequest)` per
 * PRD-500-R5.
 */
export function createActRuntime(config: ActRuntimeConfig): ActRuntimeInstance {
  const manifest = ensureManifestPRD500R8(config.manifest);
  validateCapabilityNegotiation(manifest, config.runtime);

  const basePath = config.basePath ?? '';
  const wellKnownPath = config.wellKnownPath ?? '/.well-known/act.json';
  const etagComputer = config.etagComputer ?? defaultEtagComputer;
  const logger = config.logger ?? NOOP_LOGGER;
  const tenantResolver = config.tenantResolver ?? DEFAULT_TENANT_RESOLVER;
  const anonymousCacheSeconds = config.anonymousCacheSeconds ?? 0;

  const ctx = {
    manifest,
    runtime: config.runtime,
    identityResolver: config.identityResolver,
    tenantResolver,
    etagComputer,
    logger,
    basePath,
    wellKnownPath,
    anonymousCacheSeconds,
  };

  return {
    basePath,
    wellKnownPath,
    manifest,
    dispatch(req: ActRequest): Promise<ActResponse> {
      return dispatch(req, ctx);
    },
  };
}
