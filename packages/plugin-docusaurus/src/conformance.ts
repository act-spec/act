/**
 * PRD-404-R14 — conformance band auto-detection. Wraps PRD-400-R17's
 * inferAchievedLevel with Docusaurus-specific signals (versioned-docs
 * mounts and per-locale Pattern-2 manifests both upgrade to Plus).
 */
import { inferAchievedLevel } from '@act-spec/generator-core';

export interface ObservedDocusaurusEmissions {
  hasIndex: boolean;
  hasSubtree: boolean;
  hasNdjson: boolean;
  /** Per-version `/v{N}/.well-known/act.json` manifests detected. */
  hasVersionMounts: boolean;
  /** Per-locale `/{locale}/.well-known/act.json` manifests detected. */
  hasI18nManifests: boolean;
}

export function detectAchievedBand(
  observed: ObservedDocusaurusEmissions,
): 'core' | 'standard' | 'strict' {
  if (observed.hasVersionMounts || observed.hasI18nManifests) return 'strict';
  return inferAchievedLevel({
    hasIndex: observed.hasIndex,
    hasSubtree: observed.hasSubtree,
    hasNdjson: observed.hasNdjson,
  });
}
