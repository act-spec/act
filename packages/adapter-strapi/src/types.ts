/**
 * PRD-205 Strapi adapter — public + internal type surface.
 *
 * Every type cites a PRD-205-R{n} requirement. Mirrors PRD-205's
 * §"Wire format / interface definition" so user-facing config is
 * stable across the implementation file split.
 */

/**
 * PRD-205-R2 — config schema (TypeScript projection).
 */
export interface StrapiAdapterConfig {
  /** Base URL of the Strapi server (no trailing slash). */
  baseUrl: string;
  /** API token (string OR `{ from_env: "<NAME>" }` reference). */
  apiToken: string | { from_env: string };
  /** Strapi content-type plural identifiers (e.g. `["articles", "tutorials"]`). */
  contentTypes: string[];
  /** Default `"v5"`. */
  strapiVersion?: 'v4' | 'v5';
  /** Default `"rest"`. */
  transport?: 'rest' | 'graphql';
  /** Default `"/graphql"`. Only used when `transport: "graphql"`. */
  graphqlEndpoint?: string;
  /** Operator-supplied GraphQL query string. Only used when `transport: "graphql"`. */
  graphqlQuery?: string;
  /** Strapi content-type singular → ACT type. Identity by default. */
  typeMapping?: Record<string, string>;
  /** Field-level mapping. Defaults documented in PRD-205-R8 table. */
  fieldMapping?: {
    title?: string;
    summary?: string;
    abstract?: string;
    body?: string;
    tags?: string;
    related?: Record<string, string /* relation */>;
    [actField: string]: unknown;
  };
  /** Override default ID derivation. */
  idField?: string;
  /** Default `false`. When `true`, body markdown is split into prose/code/callout. */
  parseMarkdown?: boolean;
  /** Range 0–4. Default 1. */
  populateDepth?: number;
  /** Component → marketing:* mapping (Plus). */
  componentMapping?: Record<
    string,
    { type: string; fields: Record<string, unknown> }
  >;
  /** Range 1–3. Default 3. */
  dynamicZoneMax?: number;
  /** Locale config (Plus); enables Strapi i18n fan-out. */
  locale?: { locales: string[]; defaultLocale: string };
  /** Summary strategy. */
  summary?: { strategy: 'field' | 'extract' | 'needs-llm' };
  /** Concurrency cap. */
  concurrency?: { transform?: number };
  /** ID namespace prefix (default `"act-strapi"`). */
  namespace?: string;
  /** Webhook secret (used by external receiver via `verifyWebhookSignature`). */
  webhookSecret?: string;
  /** When the configured filter returns 0 entities, suppress the warning. */
  allowEmpty?: boolean;
  /** Debug log token fingerprint (PRD-205-R24). */
  debugLogging?: boolean;
}

// ---------------------------------------------------------------------------
// Strapi entity shapes (covers v4 wrap-and-attributes form + v5 flat form)
// ---------------------------------------------------------------------------

/**
 * PRD-205-R8 / R26 — A normalized Strapi entity used by the adapter
 * downstream of the response-envelope normalization. The adapter accepts
 * either Strapi v4 (`{ data: { id, attributes: {...} } }`) or v5 (`{ id,
 * documentId, ...attrs }`) on input and projects both into this shape.
 */
export interface StrapiEntity {
  /** Numeric Strapi `id` (always present in v4 + v5). */
  id: number | string;
  /** Strapi v5 `documentId`. Absent in v4 entities. */
  documentId?: string;
  /** Synthesized: the content type plural form this entity came from. */
  __contentType: string;
  /** Synthesized: locale this entity was fetched as (Strapi i18n). */
  __locale?: string;
  /** Sibling-locale references (v4 `localizations` / v5 sibling array). */
  localizations?: Array<{ locale: string; documentId?: string; id?: number }>;
  /** Arbitrary attribute fields (title, body, tags, dynamic zones, …). */
  [attr: string]: unknown;
}

/** Strapi v4 wrap-and-attributes envelope item. */
export interface StrapiV4DataItem {
  id: number;
  attributes: Record<string, unknown>;
}

/** Strapi REST list response envelope. */
export interface StrapiListResponse {
  data: StrapiV4DataItem[] | Array<Record<string, unknown>>;
  meta?: { pagination?: { page?: number; pageCount?: number; total?: number; pageSize?: number } };
}

/** Strapi GraphQL response shape (loose). */
export interface StrapiGraphQLResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

/** Strapi dynamic-zone instance shape (loose; component name + fields). */
export interface StrapiDynamicZoneEntry {
  __component: string;
  id?: number;
  [field: string]: unknown;
}

/** Recorded Strapi Content-API corpus — the test/fixture path. */
export interface StrapiSourceCorpus {
  /** Per content-type plural → list of entities (v4 OR v5 envelope shapes). */
  entitiesByContentType: Record<
    string,
    Array<StrapiV4DataItem | Record<string, unknown>>
  >;
  /** Per locale → per content-type → entities (used for locale fan-out). */
  entitiesByLocale?: Record<string, Record<string, Array<StrapiV4DataItem | Record<string, unknown>>>>;
  /** Per content-type plural → singular form (e.g. `articles → article`). */
  contentTypeSingulars?: Record<string, string>;
  /** Optional precomputed delta cursor (the latest `updatedAt` observed). */
  latestUpdatedAt?: string;
  /** Probe response for `init` (default `'ok'`). */
  authProbe?: 'ok' | 'unauthorized' | 'server_version_mismatch';
  /** Default Strapi server version reported by the probe (when absent, matches config). */
  serverStrapiVersion?: 'v4' | 'v5';
  /** Per content-type → 404 (used to test PRD-205-R5 unrecoverable failure). */
  unknownContentTypes?: string[];
}

/** PRD-205 — opaque source item flowing enumerate → transform. */
export interface StrapiItem {
  entity: StrapiEntity;
  /** Resolved locale per PRD-205-R15; null when locale config absent. */
  locale: string | null;
  /** Sibling locales (other-language counterparts) per R15. */
  siblings?: Array<{ locale: string; id: string }>;
}
