/**
 * PRD-408 Eleventy plugin — public type surface.
 *
 * The package treats `@11ty/eleventy` as an OPTIONAL peer dependency
 * (per PRD-408-R2 / package.json `peerDependenciesMeta`); we re-declare
 * the structural slice of Eleventy's plugin / hook API the factory
 * consumes. The structural shape matches Eleventy 2.0+'s `eleventyConfig`
 * + `eleventy.after` event payload; consumers who have Eleventy installed
 * pass the real values through unchanged.
 */
import type { GeneratorConfig } from '@act-spec/generator-core';

/**
 * Structural slice of Eleventy's `EleventyConfig`. Real Eleventy passes
 * many additional fields and methods; the plugin only reads / calls what
 * is declared here.
 */
export interface EleventyConfigLike {
  /**
   * PRD-408-R2 — Eleventy 2.0+ exposes `versionCheck` (a function that
   * throws on a major-version mismatch). Older releases do not, which
   * itself is the < 2.0 signal.
   */
  versionCheck?: (range: string) => void;
  /**
   * PRD-408-R5 — event emitter API. The plugin subscribes to
   * `eleventy.after` exclusively.
   */
  on: (event: string, callback: EleventyEventCallback) => void;
  /**
   * PRD-408-R3 — Eleventy's resolved I/O directories. Default
   * `{ input: '.', output: '_site' }` per Eleventy 2.0+.
   */
  dir?: { input?: string; output?: string };
  /**
   * PRD-408-R11 — Eleventy `addCollection`-defined collections.
   * Auto-detected when `act.collections.synthesizeIndices === true`.
   */
  collections?: Record<string, unknown>;
  /**
   * PRD-408-R15 — best-effort access to Eleventy's ignore list. The
   * `ignores.add` API is present in newer Eleventy 2.x releases; older
   * 2.0.x lack it (the plugin tolerates absence per R15).
   */
  ignores?: { add?: (pattern: string) => void };
}

/**
 * Eleventy `eleventy.after` callback shape (PRD-408-R5). The 2.0+ payload
 * is `{ dir, results, runMode, outputMode }`. The plugin reads `dir` and
 * `results`; other fields are tolerated unchanged per PRD-108-R7.
 */
export type EleventyEventCallback = (
  payload: EleventyAfterPayload,
) => unknown;

export interface EleventyAfterPayload {
  /** Eleventy's resolved IO directories at build time. */
  dir: { input: string; output: string; data?: string; includes?: string };
  /**
   * Per-output-file results array. Each entry corresponds to one written
   * file in the public output. `permalink: false` files are absent from
   * this array per Eleventy's documented behavior — PRD-408-R6 is the
   * mitigation that prevents draft leakage into ACT.
   */
  results: EleventyResultEntry[];
  /** `build` | `serve` | `watch`. */
  runMode?: string;
  /** `fs` | `json` | `ndjson`. */
  outputMode?: string;
}

export interface EleventyResultEntry {
  /** Project-relative source path (e.g., `./posts/hello.md`). */
  inputPath: string;
  /** Absolute output path Eleventy wrote. */
  outputPath: string;
  /** The URL Eleventy serves the file at (e.g., `/posts/hello/`). */
  url: string;
}

/**
 * PRD-408-R12 — public options surface.
 *
 * Strict subset of `GeneratorConfig` (PRD-400-R31). The plugin translates
 * this shape into a fully-formed `GeneratorConfig` before invoking the
 * pipeline.
 */
export interface EleventyActOptions {
  /** PRD-408-R12 / R17. Default `"core"`. */
  conformanceTarget?: 'core' | 'standard' | 'strict';
  /** PRD-408-R12 / R13. Default `eleventyConfig.dir.output` (typically `_site/`). */
  outputDir?: string;
  /** PRD-408-R12 — REQUIRED. The deployment origin. */
  baseUrl: string;
  /** PRD-408-R12 — REQUIRED. Site identity for the manifest. */
  manifest: { site: { name: string; description?: string; canonical_url?: string } };
  /** PRD-408-R12 — REQUIRED. URL templates. */
  urlTemplates: NonNullable<GeneratorConfig['urlTemplates']>;
  /** PRD-408-R12. Default `false`. */
  failOnExtractionError?: boolean;
  /** PRD-408-R12. Default `false` — Eleventy already manages its own incremental rebuild. */
  incremental?: boolean;
  /** PRD-408-R12. Escape hatch — replaces auto-wired markdown adapter. */
  adapters?: GeneratorConfig['adapters'];
  /** PRD-408-R11. Optional collection-hint controls. */
  collections?: { synthesizeIndices?: boolean };
  /** PRD-408-R17. Plus band requires this when conformanceTarget === 'strict'. */
  searchArtifactPath?: string;
  /** PRD-408-R12 / PRD-400-R24. */
  hooks?: {
    preBuild?: (...args: unknown[]) => unknown;
    postBuild?: (...args: unknown[]) => unknown;
    onError?: (...args: unknown[]) => unknown;
  };
  /**
   * PRD-408-R12 (per amendment A10) — body-to-block parse mode forwarded
   * to PRD-201's auto-wired markdown adapter (PRD-201-R12). `"coarse"`
   * (default) emits one `markdown` block per file; `"fine"` splits into
   * prose / code / data / callout blocks. Setting `"fine"` against
   * `conformanceTarget: "core"` fails at init per PRD-201-R23.
   */
  parseMode?: 'coarse' | 'fine';
  /** PRD-408-R10 — supplying `bindings` is a configuration error. */
  bindings?: never;
}

/** PRD-408-R5 / R19 — internal state surfaced to tests + observability. */
export interface EleventyPluginState {
  /** PRD-408-R5 / R19 — re-entry guard for watch mode. */
  inFlight: Promise<unknown> | undefined;
  /** Total `eleventy.after` invocations seen. */
  invocations: number;
  /** Last computed build-report path (for tests). */
  lastBuildReportPath: string | undefined;
  /** Aggregated warnings the most recent build emitted (for tests). */
  lastWarnings: string[];
}
