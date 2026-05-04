/**
 * PRD-500-R22 — Cache-Control + Vary headers per resolved identity & tenant.
 *
 *  - Principal → `Cache-Control: private, must-revalidate` + `Vary` on the
 *    primary auth scheme's header.
 *  - Anonymous + single-tenant → `Cache-Control: public, max-age=<n>`.
 *  - Anonymous + scoped-tenant → `Cache-Control: public, max-age=<n>` (the
 *    host wires the tenant-disambiguating `Vary` header per their tenant
 *    derivation strategy; PRD-500 cannot infer it for them).
 *
 * The SDK MUST NOT emit `Cache-Control: private` on a `null`/anonymous
 * response — that would falsely scope a public response per PRD-500-R22.
 */
import type { Identity, Manifest, Tenant } from './types.js';

/**
 * PRD-500-R22 — derive `Cache-Control` based on identity + tenant.
 */
export function cacheControlFor(
  identity: Identity,
  tenant: Tenant,
  anonymousCacheSeconds: number,
): string {
  if (identity.kind === 'principal') return 'private, must-revalidate';
  // Anonymous (single OR scoped) — public, host-overridable max-age.
  void tenant; // tenant participates in Vary, not Cache-Control.
  return `public, max-age=${anonymousCacheSeconds}`;
}

/**
 * PRD-500-R22 — derive the `Vary` header for the response. For principals,
 * we look at the manifest's first declared scheme to pick `Authorization`
 * vs `Cookie`. Anonymous responses get no `Vary` from PRD-500 (host-supplied
 * tenant disambiguation is the host's responsibility).
 */
export function varyFor(identity: Identity, manifest: Manifest): string | null {
  if (identity.kind !== 'principal') return null;
  const auth = manifest.auth as { schemes?: ReadonlyArray<string> } | undefined;
  const primary = auth?.schemes?.[0];
  if (primary === 'cookie') return 'Cookie';
  // Bearer / oauth2 / api_key → all carry credentials in the Authorization
  // header by the PRD-106-R10 default.
  return 'Authorization';
}

/**
 * Apply the cache-control + vary headers to an outgoing response. Mutates
 * the `Headers` argument in place per the standard Headers-builder pattern.
 */
export function applyCacheHeaders(
  headers: Headers,
  identity: Identity,
  tenant: Tenant,
  manifest: Manifest,
  anonymousCacheSeconds: number,
): void {
  headers.set('Cache-Control', cacheControlFor(identity, tenant, anonymousCacheSeconds));
  const vary = varyFor(identity, manifest);
  if (vary) headers.set('Vary', vary);
}
