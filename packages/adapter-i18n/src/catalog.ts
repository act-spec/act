/**
 * PRD-207-R3 — per-library message-catalog loaders.
 *
 *  - `next-intl`: per-locale JSON file `<messagesDir>/<locale>.json`. Nested
 *    objects are flattened to dotted keys.
 *  - `react-intl`: per-locale JSON file `<messagesDir>/<locale>.json`. Either
 *    the FormatJS extracted-messages flat shape (`{ id: { defaultMessage } }`)
 *    or the nested `{ id: "translated text" }` shape.
 *  - `i18next`: per-locale per-namespace JSON file
 *    `<messagesDir>/<locale>/<namespace>.json`. Each namespace's keys are
 *    flattened and prefixed with the namespace.
 *
 * Recoverable failures (file missing) → caller emits a warning per
 * PRD-207-R9. Unrecoverable failures (invalid JSON) → caller throws
 * I18nAdapterError per PRD-207-R14.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { I18nAdapterError } from './errors.js';
import type { FlatCatalog, I18nAdapterConfig } from './types.js';

/**
 * PRD-207 security — refuse files whose canonicalized path lies outside
 * `messagesDir`. The threat is a content author with write access to a
 * locale-named symlink target outside `messagesDir`.
 */
async function safeJoin(root: string, ...segments: string[]): Promise<string> {
  const candidate = path.join(root, ...segments);
  const resolved = await fs.realpath(candidate).catch(() => candidate);
  const rootResolved = await fs.realpath(root).catch(() => root);
  const rel = path.relative(rootResolved, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new I18nAdapterError({
      code: 'config_invalid',
      message: `PRD-207 security: path '${candidate}' resolves outside messagesDir '${root}' (path traversal refused)`,
    });
  }
  return candidate;
}

/**
 * Walk an arbitrarily nested object and flatten every leaf string into the
 * provided map under its dotted path. Non-string leaves are ignored — i18n
 * libraries occasionally embed metadata (numbers, ICU plural objects) that
 * the adapter does not consume directly. Per PRD-207-R3, the adapter only
 * needs to know which keys are present and translated, not to evaluate them.
 */
function flattenInto(out: FlatCatalog, value: unknown, prefix: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.length > 0) out.set(prefix, value);
    return;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = prefix.length > 0 ? `${prefix}.${k}` : k;
      flattenInto(out, v, next);
    }
    return;
  }
  // arrays / numbers / booleans: skipped intentionally per the rule above.
}

export function flattenObject(value: unknown): FlatCatalog {
  const out: FlatCatalog = new Map();
  flattenInto(out, value, '');
  return out;
}

/**
 * Load a single locale's catalog. Returns `null` on ENOENT (caller decides
 * how to surface) and throws `I18nAdapterError({ code: 'catalog_parse' })`
 * on invalid JSON or path traversal.
 */
export async function loadLocaleCatalog(
  config: I18nAdapterConfig,
  locale: string,
): Promise<FlatCatalog | null> {
  switch (config.library) {
    case 'next-intl':
      return loadNextIntl(config.messagesDir, locale);
    case 'react-intl':
      return loadReactIntl(
        config.messagesDir,
        locale,
        config.library_options?.messageFormat ?? 'flat',
      );
    case 'i18next':
      return loadI18next(
        config.messagesDir,
        locale,
        config.library_options?.namespaces ?? [],
      );
  }
}

async function readJson(filePath: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new I18nAdapterError({
      code: 'catalog_parse',
      message: `PRD-207-R14: failed to read catalog file '${filePath}': ${(err as Error).message}`,
    });
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new I18nAdapterError({
      code: 'catalog_parse',
      message: `PRD-207-R14: invalid JSON in catalog file '${filePath}': ${(err as Error).message}`,
    });
  }
}

async function loadNextIntl(dir: string, locale: string): Promise<FlatCatalog | null> {
  const filePath = await safeJoin(dir, `${locale}.json`);
  const parsed = await readJson(filePath);
  if (parsed === null) return null;
  return flattenObject(parsed);
}

async function loadReactIntl(
  dir: string,
  locale: string,
  format: 'flat' | 'nested',
): Promise<FlatCatalog | null> {
  const filePath = await safeJoin(dir, `${locale}.json`);
  const parsed = await readJson(filePath);
  if (parsed === null) return null;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new I18nAdapterError({
      code: 'catalog_parse',
      message: `PRD-207-R14: react-intl catalog '${filePath}' must be a JSON object`,
    });
  }
  const out: FlatCatalog = new Map();
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      format === 'flat'
      && typeof v === 'object'
      && v !== null
      && !Array.isArray(v)
      && 'defaultMessage' in (v as Record<string, unknown>)
    ) {
      const dm = (v as { defaultMessage: unknown }).defaultMessage;
      if (typeof dm === 'string' && dm.length > 0) out.set(k, dm);
    } else if (typeof v === 'string') {
      if (v.length > 0) out.set(k, v);
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      // nested format with a sub-object — flatten under the outer key
      flattenInto(out, v, k);
    }
  }
  return out;
}

async function loadI18next(
  dir: string,
  locale: string,
  namespaces: string[],
): Promise<FlatCatalog | null> {
  const out: FlatCatalog = new Map();
  let anyFound = false;
  for (const ns of namespaces) {
    const filePath = await safeJoin(dir, locale, `${ns}.json`);
    const parsed = await readJson(filePath);
    if (parsed === null) continue;
    anyFound = true;
    const sub: FlatCatalog = new Map();
    flattenInto(sub, parsed, '');
    for (const [k, v] of sub) out.set(`${ns}.${k}`, v);
  }
  return anyFound ? out : null;
}
