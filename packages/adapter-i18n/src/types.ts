/**
 * PRD-207 i18n adapter — public + internal type surface.
 *
 * Every exported type cites a PRD-207-R{n} requirement. Mirrors PRD-207's
 * §"Wire format / interface definition" so user-facing config is stable
 * across the implementation file split.
 */

/** PRD-207-R2 — supported i18n libraries (closed enum). */
export type I18nLibrary = 'next-intl' | 'react-intl' | 'i18next';

/** PRD-207-R7 — closed enum mirroring PRD-104-R11. */
export type TranslationStatus = 'complete' | 'partial' | 'fallback' | 'missing';

/**
 * PRD-207-R2 — config schema (TypeScript projection).
 */
export interface I18nAdapterConfig {
  /** PRD-207-R2 — required; chooses the catalog file convention. */
  library: I18nLibrary;
  /** PRD-207-R2 — required; root directory for catalog files. */
  messagesDir: string;
  /** PRD-207-R2 — locale set + optional fallback chain. */
  locales: {
    /** BCP-47 subset per PRD-104-R2. */
    default: string;
    /** Non-empty; MUST include `default`. */
    available: string[];
    /** Per-locale fallback chain override (PRD-207-R8). */
    fallback_chain?: Record<string, string[]>;
  };
  /** PRD-207-R2 — name of the primary adapter we contribute partials to. */
  bindToAdapter: string;
  /** PRD-207-R2 — Pattern 1 vs Pattern 2 selector + namespace prefix. */
  idTransform?: {
    /** Default 1 (locale-prefixed IDs). */
    pattern?: 1 | 2;
    /** Default = bindToAdapter without the leading `act-`. */
    namespace?: string;
  };
  /** PRD-207-R2 — optional `(targetLocale:baseId) → mapped id` lookup. */
  keyMapping?: Record<string, string>;
  /** PRD-207-R2 — library-specific knobs. */
  library_options?: {
    namespaces?: string[];
    messageFormat?: 'flat' | 'nested';
  };
  /**
   * PRD-207 (autonomous) — when true, the adapter probes `messagesDir`
   * for the conventional layout of the configured library and warns
   * (not errors) on mismatch. Default false.
   */
  autoDetect?: boolean;
}

/**
 * PRD-207-R3 — flattened catalog: `dotted.key` → translated string.
 * Per-library loaders all collapse their native shape to this map.
 */
export type FlatCatalog = Map<string, string>;

/**
 * PRD-207 internal — one yielded item per `(locale, nodeKey)` pair.
 * Consumed by `transform` to produce the partial node.
 */
export interface I18nItem {
  /** Normalized BCP-47 subset locale (PRD-207-R13). */
  locale: string;
  /** ACT ID this partial contributes to (PRD-207-R4). */
  bindingId: string;
  /** PRD-207-R7 — node-level translation status. */
  status: TranslationStatus;
  /** PRD-207-R8 — set iff `status === "fallback"`. */
  fallback_from?: string;
  /** PRD-207-R5 — dense `[{locale,id}]` for other locales that have a translation. */
  translations: Array<{ locale: string; id: string }>;
  /** PRD-207-R17 — `metadata.source.source_id` carrier. */
  catalogKey: string;
}

/**
 * PRD-207-R3 — the per-library detection result returned by autoDetect.
 * Captures whether the conventional layout was found AND any namespaces
 * the i18next probe sniffed.
 */
export interface DetectionResult {
  detected: boolean;
  namespaces?: string[];
  reason: string;
}
