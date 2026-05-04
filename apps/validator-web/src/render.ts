// SPDX-License-Identifier: Apache-2.0
/**
 * Pure HTML rendering helpers. Returns escaped HTML strings; the caller
 * assigns to `innerHTML`. Kept side-effect-free so we could unit-test the
 * render output if needed (for v0.1 we keep visual tests out per the
 * task brief).
 */
import type {
  ConformanceReport,
  Gap,
  ValidationResult,
  Warning,
} from '@act-spec/validator';
import type { EnvelopeKind } from './detect.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderGapList(gaps: readonly Gap[]): string {
  if (gaps.length === 0) {
    return '<p class="ok">No gaps — the envelope conforms.</p>';
  }
  const items = gaps
    .map(
      (g) => `
        <li class="finding finding--gap finding--${esc(g.level)}">
          <span class="finding__band">${esc(g.level)}</span>
          <span class="finding__msg">${esc(g.missing)}</span>
        </li>`,
    )
    .join('');
  return `<ul class="findings">${items}</ul>`;
}

function renderWarningList(warnings: readonly Warning[]): string {
  if (warnings.length === 0) return '<p class="muted">No warnings.</p>';
  const items = warnings
    .map(
      (w) => `
        <li class="finding finding--warn finding--${esc(w.level)}">
          <span class="finding__band">${esc(w.level)}</span>
          <span class="finding__code">${esc(w.code)}</span>
          <span class="finding__msg">${esc(w.message)}</span>
        </li>`,
    )
    .join('');
  return `<ul class="findings">${items}</ul>`;
}

export function renderPasteResult(input: {
  envelope: EnvelopeKind;
  result: ValidationResult;
}): string {
  const { envelope, result } = input;
  const verdict = result.gaps.length === 0
    ? `<span class="verdict verdict--ok">PASS</span>`
    : `<span class="verdict verdict--fail">${result.gaps.length} gap${result.gaps.length === 1 ? '' : 's'}</span>`;
  return `
    <section class="result">
      <header class="result__header">
        <h2>Paste validation result</h2>
        <p class="muted">Detected envelope: <code>${esc(envelope)}</code> ${verdict}</p>
      </header>
      <section>
        <h3>Gaps</h3>
        ${renderGapList(result.gaps)}
      </section>
      <section>
        <h3>Warnings</h3>
        ${renderWarningList(result.warnings)}
      </section>
    </section>
  `;
}

export function renderUrlReport(input: {
  report: ConformanceReport;
  corsBlocked?: boolean;
}): string {
  const { report, corsBlocked } = input;
  const cors = corsBlocked
    ? `<aside class="cors-warning" role="alert">
         <strong>CORS blocked the fetch.</strong>
         Browsers cannot bypass CORS without a backend. Switch to the
         <button type="button" class="link" data-action="switch-to-paste">paste mode</button>
         and paste your manifest JSON instead — same validator, no fetch needed.
       </aside>`
    : '';
  const declared = `${esc(report.declared.level ?? '<unknown>')} / ${esc(report.declared.delivery ?? '<unknown>')}`;
  const achieved = `${esc(report.achieved.level ?? '<none>')} / ${esc(report.achieved.delivery ?? '<unknown>')}`;
  const gapCount = report.gaps.length;
  const verdict = gapCount === 0
    ? `<span class="verdict verdict--ok">PASS</span>`
    : `<span class="verdict verdict--fail">${gapCount} gap${gapCount === 1 ? '' : 's'}</span>`;
  return `
    <section class="result">
      <header class="result__header">
        <h2>Conformance report</h2>
        <p class="muted">Target: <code>${esc(report.url)}</code></p>
        <dl class="report-meta">
          <dt>Declared</dt><dd>${declared}</dd>
          <dt>Achieved</dt><dd>${achieved}</dd>
          <dt>Verdict</dt><dd>${verdict}</dd>
          <dt>act_version</dt><dd>${esc(report.act_version)}</dd>
          <dt>Passed at</dt><dd>${esc(report.passed_at)}</dd>
        </dl>
      </header>
      ${cors}
      <section>
        <h3>Gaps</h3>
        ${renderGapList(report.gaps)}
      </section>
      <section>
        <h3>Warnings</h3>
        ${renderWarningList(report.warnings)}
      </section>
      <details class="raw-report">
        <summary>Raw JSON report</summary>
        <pre><code>${esc(JSON.stringify(report, null, 2))}</code></pre>
      </details>
    </section>
  `;
}

export function renderError(message: string): string {
  return `<section class="result result--error" role="alert">
    <h2>Validator error</h2>
    <p>${esc(message)}</p>
  </section>`;
}
