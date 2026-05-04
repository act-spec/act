/**
 * Envelope parsing wrappers (PRD-601-R1).
 *
 * The inspector NEVER ships its own schema parser. Every envelope it
 * sees is funneled through `@act-spec/validator`'s per-envelope
 * validators; the result's `gaps` and `warnings` are converted into
 * the inspector's `Finding` shape so that the inspector's output
 * stream uses one vocabulary (`findings`) rather than the validator's
 * conformance-shaped `gaps[]`. PRD-601-R21 enforces this separation:
 * the inspector reports findings, NOT a PRD-107 `ConformanceReport`.
 */
import {
  validateIndex,
  validateManifest,
  validateNdjsonIndex,
  validateNode,
  validateSubtree,
} from '@act-spec/validator';
import type { Gap, Warning } from '@act-spec/core';
import type { Finding } from './types.js';

function gapToFinding(g: Gap): Finding {
  return {
    code: 'envelope-' + g.requirement.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    message: `${g.requirement}: ${g.missing}`,
    severity: 'error',
  };
}

function warningToFinding(w: Warning): Finding {
  return {
    code: w.code,
    message: w.message,
    severity: 'warn',
  };
}

export interface ParsedEnvelope<T> {
  value: T | null;
  findings: Finding[];
}

/**
 * Parse a manifest. Returns `{ value: null }` when the body has any
 * `gap` (i.e. is structurally invalid); warnings are surfaced as
 * `info`/`warn` findings without nulling the value.
 */
export function parseManifest(body: unknown): ParsedEnvelope<Record<string, unknown>> {
  const r = validateManifest(body);
  const findings = [...r.gaps.map(gapToFinding), ...r.warnings.map(warningToFinding)];
  return {
    value: r.gaps.length === 0 && body && typeof body === 'object' ? (body as Record<string, unknown>) : null,
    findings,
  };
}

export function parseIndex(body: unknown): ParsedEnvelope<Record<string, unknown>> {
  const r = validateIndex(body);
  const findings = [...r.gaps.map(gapToFinding), ...r.warnings.map(warningToFinding)];
  return {
    value: r.gaps.length === 0 && body && typeof body === 'object' ? (body as Record<string, unknown>) : null,
    findings,
  };
}

export function parseNode(body: unknown): ParsedEnvelope<Record<string, unknown>> {
  const r = validateNode(body);
  const findings = [...r.gaps.map(gapToFinding), ...r.warnings.map(warningToFinding)];
  return {
    value: r.gaps.length === 0 && body && typeof body === 'object' ? (body as Record<string, unknown>) : null,
    findings,
  };
}

export function parseSubtree(body: unknown): ParsedEnvelope<Record<string, unknown>> {
  const r = validateSubtree(body);
  const findings = [...r.gaps.map(gapToFinding), ...r.warnings.map(warningToFinding)];
  return {
    value: r.gaps.length === 0 && body && typeof body === 'object' ? (body as Record<string, unknown>) : null,
    findings,
  };
}

export function parseNdjsonIndex(body: string): ParsedEnvelope<string> {
  const r = validateNdjsonIndex(body);
  const findings = [...r.gaps.map(gapToFinding), ...r.warnings.map(warningToFinding)];
  return {
    value: r.gaps.length === 0 ? body : null,
    findings,
  };
}
