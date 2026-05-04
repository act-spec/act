/**
 * Polylang / WPML detection. WordPress core has no native i18n surface; both
 * popular plugins decorate REST payloads with extra fields:
 *
 *  - **Polylang** sets `lang` (BCP-47 short code) on each post and a
 *    `translations: { localeCode: postId }` map.
 *  - **WPML** sets `wpml_current_locale` on each post and a
 *    `wpml_translations: { localeCode: { id, ... } }` map.
 *
 * `detectI18nMode` examines a sample post and returns `'polylang' | 'wpml' |
 * 'none'`. `extractLocale` and `extractTranslations` then surface the
 * per-post fields the mapper needs.
 */
import type { WordPressPost } from './types.js';

export type I18nMode = 'polylang' | 'wpml' | 'none';

/**
 * Detect i18n mode from a sample post's payload. Returns `'none'` when
 * neither plugin's marker fields are present. The first sampled post's
 * mode is sticky for the build (WordPress sites do not mix Polylang and
 * WPML in practice).
 */
export function detectI18nMode(sample: WordPressPost | undefined): I18nMode {
  if (!sample) return 'none';
  if (typeof sample.lang === 'string' && sample.lang.length > 0) return 'polylang';
  if (typeof sample.translations === 'object' && sample.translations !== null) return 'polylang';
  if (typeof sample.wpml_current_locale === 'string' && sample.wpml_current_locale.length > 0) {
    return 'wpml';
  }
  if (typeof sample.wpml_translations === 'object' && sample.wpml_translations !== null) {
    return 'wpml';
  }
  return 'none';
}

/** Extract this post's locale per the resolved mode. */
export function extractLocale(post: WordPressPost, mode: I18nMode): string | undefined {
  if (mode === 'polylang' && typeof post.lang === 'string') return post.lang;
  if (mode === 'wpml' && typeof post.wpml_current_locale === 'string') {
    return post.wpml_current_locale;
  }
  return undefined;
}

/**
 * Extract a `(locale → wp post id)` translation map per the resolved mode.
 * Returns an empty record when the mode is `'none'` or the post lacks the
 * marker field.
 */
export function extractTranslations(
  post: WordPressPost,
  mode: I18nMode,
): Record<string, number> {
  if (mode === 'polylang' && post.translations && typeof post.translations === 'object') {
    const out: Record<string, number> = {};
    for (const [locale, id] of Object.entries(post.translations)) {
      if (typeof id === 'number') out[locale] = id;
    }
    return out;
  }
  if (mode === 'wpml' && post.wpml_translations && typeof post.wpml_translations === 'object') {
    const out: Record<string, number> = {};
    for (const [locale, ref] of Object.entries(post.wpml_translations)) {
      const id = (ref as { id?: unknown } | null)?.id;
      if (typeof id === 'number') {
        out[locale] = id;
      }
    }
    return out;
  }
  return {};
}
