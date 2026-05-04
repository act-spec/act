/**
 * PRD-207-R5 — cross-locale ID resolution.
 *
 * Pattern 1 (locale-prefixed IDs): the primary adapter has emitted an ID
 * shaped `<namespace>/<locale-lower>/<rest>`; we swap the locale segment.
 * Pattern 2 (per-locale manifests): the same ID is used across locales
 * (the manifest layer differentiates).
 *
 * When neither rule applies AND `keyMapping` does not provide an explicit
 * `<targetLocale>:<baseId> → mappedId` entry, we return null and the caller
 * surfaces a recoverable warning per PRD-207-R9.
 */
import type { I18nAdapterConfig } from './types.js';

export interface ResolveOpts {
  warn: (msg: string) => void;
}

export function inferNamespace(config: I18nAdapterConfig): string {
  const explicit = config.idTransform?.namespace;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  return config.bindToAdapter.replace(/^act-/, '');
}

export function resolveCrossLocaleId(
  baseLocale: string,
  baseId: string,
  targetLocale: string,
  config: I18nAdapterConfig,
  opts: ResolveOpts,
): string | null {
  // Pattern 2: same id across locales.
  if (config.idTransform?.pattern === 2) return baseId;

  const ns = inferNamespace(config);
  const baseLower = baseLocale.toLowerCase();
  const targetLower = targetLocale.toLowerCase();
  const prefix = `${ns}/${baseLower}/`;
  if (baseId.startsWith(prefix)) {
    return `${ns}/${targetLower}/${baseId.slice(prefix.length)}`;
  }

  // Explicit override fallback.
  const mappedKey = `${targetLocale}:${baseId}`;
  const mapped = config.keyMapping?.[mappedKey];
  if (typeof mapped === 'string' && mapped.length > 0) return mapped;

  opts.warn(
    `PRD-207-R5/R9: cross-locale ID resolution failed for '${baseLocale}:${baseId}' → '${targetLocale}'; supply keyMapping['${mappedKey}'] or align primary adapter's ID grammar`,
  );
  return null;
}

/**
 * PRD-207-R4 — compute the binding ID this adapter contributes a partial
 * to, given the catalog key (the "node identity" the catalog uses) and
 * the locale.
 *
 * The default rule reflects the canonical PRD-202 Pattern 1 layout:
 * `<namespace>/<locale-lower>/<key>`. `keyMapping` can override per-key.
 */
export function computeBindingId(
  catalogKey: string,
  locale: string,
  config: I18nAdapterConfig,
): string {
  // keyMapping covers the explicit case before any synthesis.
  const explicit = config.keyMapping?.[`${locale}:${catalogKey}`];
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const explicitBare = config.keyMapping?.[catalogKey];
  if (typeof explicitBare === 'string' && explicitBare.length > 0) {
    if (config.idTransform?.pattern === 2) return explicitBare;
    const ns = inferNamespace(config);
    return `${ns}/${locale.toLowerCase()}/${stripNamespacePrefix(explicitBare, ns)}`;
  }

  if (config.idTransform?.pattern === 2) {
    // Pattern 2: pass through.
    return catalogKey;
  }
  const ns = inferNamespace(config);
  return `${ns}/${locale.toLowerCase()}/${catalogKey}`;
}

function stripNamespacePrefix(id: string, ns: string): string {
  if (id.startsWith(`${ns}/`)) return id.slice(ns.length + 1);
  return id;
}
