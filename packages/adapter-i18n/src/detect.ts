/**
 * PRD-207 (autonomous helper) — library auto-detection.
 *
 * When the user sets `autoDetect: true`, the adapter probes
 * `messagesDir` for the conventional layout of the configured library
 * and emits a warning (not error) if the layout looks wrong. This is a
 * SHOULD-only courtesy: explicit `library` config always overrides.
 *
 *  - `next-intl`: looks for `<messagesDir>/<locale>.json` files.
 *  - `react-intl`: same shape; distinguished from next-intl by the
 *    presence of a `defaultMessage` key inside the first entry.
 *  - `i18next`: looks for `<messagesDir>/<locale>/<namespace>.json`
 *    files (i.e., subdirectories per locale).
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DetectionResult, I18nLibrary } from './types.js';

export async function detectLibraryLayout(
  messagesDir: string,
  declared: I18nLibrary,
  defaultLocale: string,
): Promise<DetectionResult> {
  const entries = await fs.readdir(messagesDir, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    return { detected: false, reason: `messagesDir '${messagesDir}' unreadable` };
  }
  const hasDefaultJson = entries.some(
    (e) => e.isFile() && e.name === `${defaultLocale}.json`,
  );
  const hasDefaultDir = entries.some(
    (e) => e.isDirectory() && e.name === defaultLocale,
  );

  switch (declared) {
    case 'next-intl':
      if (hasDefaultJson) {
        return { detected: true, reason: `next-intl: found '${defaultLocale}.json'` };
      }
      return {
        detected: false,
        reason: `next-intl declared but '${defaultLocale}.json' not found in '${messagesDir}'`,
      };
    case 'react-intl': {
      if (!hasDefaultJson) {
        return {
          detected: false,
          reason: `react-intl declared but '${defaultLocale}.json' not found in '${messagesDir}'`,
        };
      }
      // Heuristic: look for a `defaultMessage` key in the first object value.
      const sample = await fs
        .readFile(path.join(messagesDir, `${defaultLocale}.json`), 'utf8')
        .catch(() => null);
      if (sample === null) {
        return { detected: true, reason: `react-intl: file present but unreadable for shape probe` };
      }
      const looksLikeFormatJs = /"defaultMessage"\s*:/.test(sample);
      return {
        detected: true,
        reason: looksLikeFormatJs
          ? `react-intl: FormatJS extracted-messages shape detected`
          : `react-intl: nested string-map shape detected (no defaultMessage)`,
      };
    }
    case 'i18next': {
      if (!hasDefaultDir) {
        return {
          detected: false,
          reason: `i18next declared but no '${defaultLocale}/' directory in '${messagesDir}'`,
        };
      }
      const sub = await fs
        .readdir(path.join(messagesDir, defaultLocale), { withFileTypes: true })
        .catch(() => null);
      const namespaces = sub
        ? sub.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name.replace(/\.json$/, ''))
        : [];
      return {
        detected: true,
        namespaces,
        reason: `i18next: detected ${String(namespaces.length)} namespace file(s) under '${defaultLocale}/'`,
      };
    }
  }
}
