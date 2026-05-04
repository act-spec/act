// SPDX-License-Identifier: Apache-2.0
/**
 * Thin dispatcher that maps the SPA's two input modes (URL fetch / paste)
 * onto `@act-spec/validator`'s public API. The library does ALL the
 * structural and behavioural work; this module is a router, not a second
 * validator implementation.
 */
import {
  validateError,
  validateIndex,
  validateManifest,
  validateNdjsonIndex,
  validateNode,
  validateSubtree,
  validateSite,
  type ConformanceReport,
  type ValidationResult,
} from '@act-spec/validator';
import { detectEnvelopeKind, type EnvelopeKind } from './detect.js';

export interface PasteValidationOutcome {
  kind: 'paste';
  envelope: EnvelopeKind;
  result: ValidationResult;
}

export interface UrlValidationOutcome {
  kind: 'url';
  report: ConformanceReport;
  /** Set when the underlying fetch failed with a CORS-shaped error. */
  corsBlocked?: boolean;
}

export type ValidationOutcome = PasteValidationOutcome | UrlValidationOutcome;

/**
 * Validate a JSON paste. The shape is auto-detected; the caller may override
 * via `forceKind` (e.g. when the user picks "treat as index" from the UI).
 */
export function validatePaste(
  input: string,
  forceKind?: EnvelopeKind,
): PasteValidationOutcome {
  const envelope = forceKind ?? detectEnvelopeKind(input).kind;
  let result: ValidationResult;
  switch (envelope) {
    case 'manifest':
      result = validateManifest(input);
      break;
    case 'index':
      result = validateIndex(input);
      break;
    case 'subtree':
      result = validateSubtree(input);
      break;
    case 'error':
      result = validateError(input);
      break;
    case 'ndjson':
      result = validateNdjsonIndex(input);
      break;
    case 'node':
    default:
      result = validateNode(input);
      break;
  }
  return { kind: 'paste', envelope, result };
}

/**
 * Validate a manifest URL. Always uses the browser's `fetch`; runs the full
 * discovery walk via `validateSite`. CORS errors are surfaced via
 * `corsBlocked: true` so the UI can show the direct-paste remediation
 * banner per PRD-600-R23.
 */
export async function validateUrl(url: string): Promise<UrlValidationOutcome> {
  const report = await validateSite(url, {});
  const corsBlocked = report.warnings.some((w) => w.code === 'cors-blocked');
  return corsBlocked ? { kind: 'url', report, corsBlocked: true } : { kind: 'url', report };
}
