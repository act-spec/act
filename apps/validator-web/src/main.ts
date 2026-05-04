// SPDX-License-Identifier: Apache-2.0
/**
 * SPA bootstrap (PRD-600-R28 / Q8 Option 3).
 *
 * Single-page UI with three input modes:
 *
 *  1. URL paste — runs the full discovery walk via `validateSite`. CORS
 *     failures surface a remediation banner per PRD-600-R23.
 *  2. JSON paste — auto-detects envelope shape and runs the matching
 *     per-envelope validator.
 *  3. File upload — reads local JSON via `FileReader` and routes through
 *     the paste pipeline.
 *
 * The SPA shares ALL parsing and validation with `@act-spec/validator`; this
 * file only handles DOM wiring and event routing. The schema bundle is
 * inlined at build time by Vite via `schemas-bundle.ts`.
 */
import { ACT_VERSION, VALIDATOR_VERSION } from '@act-spec/validator';
import { initBrowserSchemas, bundledSchemaCount } from './schemas-bundle.js';
import { looksLikeUrl } from './detect.js';
import { validatePaste, validateUrl } from './validate.js';
import { renderError, renderPasteResult, renderUrlReport } from './render.js';

// Build-time constants (Vite `define` in vite.config.ts).
declare const __VALIDATOR_WEB_BUILD_SHA__: string;
declare const __VALIDATOR_WEB_BUILD_TIMESTAMP__: string;

// Seed the validator's schema cache from the bundled raw schemas. Must run
// before any validate* call.
initBrowserSchemas();

const APP_HTML = `
  <header class="app-header">
    <div class="app-header__brand">
      <h1>ACT Validator</h1>
      <p class="muted">Hosted reference validator for the ACT (Agent Content Tree) v0.1 wire format.</p>
    </div>
  </header>

  <aside class="cors-notice" aria-label="CORS limitation">
    <strong>Heads up:</strong> this validator runs entirely in your browser.
    URL fetches are subject to CORS — many production origins will refuse them.
    If a fetch fails, switch to <em>Paste JSON</em> below.
  </aside>

  <section class="modes" aria-label="Input mode">
    <div role="tablist" class="tablist">
      <button role="tab" aria-selected="true" data-mode="url" class="tab">
        Validate URL
      </button>
      <button role="tab" aria-selected="false" data-mode="paste" class="tab">
        Paste JSON
      </button>
      <button role="tab" aria-selected="false" data-mode="file" class="tab">
        Upload file
      </button>
    </div>

    <form id="url-form" class="panel" data-panel="url">
      <label for="url-input">Manifest URL</label>
      <input
        type="url"
        id="url-input"
        name="url"
        placeholder="https://example.com/.well-known/act.json"
        required
      />
      <p class="muted">
        We'll fetch the manifest, walk the index, and sample a few nodes
        (max 64 requests).
      </p>
      <button type="submit">Validate</button>
    </form>

    <form id="paste-form" class="panel hidden" data-panel="paste">
      <label for="paste-input">JSON envelope (manifest, node, index, subtree, error, or NDJSON)</label>
      <textarea
        id="paste-input"
        name="paste"
        rows="14"
        spellcheck="false"
        placeholder='{ "act_version": "0.1", "site": ... }'
      ></textarea>
      <div class="paste-controls">
        <label for="kind-override">Treat as:</label>
        <select id="kind-override" name="kind">
          <option value="">auto-detect</option>
          <option value="manifest">manifest</option>
          <option value="node">node</option>
          <option value="index">index (JSON)</option>
          <option value="ndjson">index (NDJSON)</option>
          <option value="subtree">subtree</option>
          <option value="error">error envelope</option>
        </select>
        <button type="submit">Validate</button>
      </div>
    </form>

    <form id="file-form" class="panel hidden" data-panel="file">
      <label for="file-input">Local JSON file</label>
      <input type="file" id="file-input" name="file" accept=".json,.ndjson,application/json" />
      <p class="muted">Reads in-browser via FileReader; nothing is uploaded.</p>
      <button type="submit">Validate</button>
    </form>
  </section>

  <section id="output" class="output" aria-live="polite"></section>

  <footer class="app-footer">
    <p>
      <strong>act_version</strong> <code>${ACT_VERSION}</code> ·
      <strong>validator</strong> <code>${VALIDATOR_VERSION}</code> ·
      <strong>build</strong> <code>${__VALIDATOR_WEB_BUILD_SHA__}</code> ·
      <strong>built</strong> <code>${__VALIDATOR_WEB_BUILD_TIMESTAMP__}</code> ·
      <strong>schemas</strong> <code>${bundledSchemaCount()}</code>
    </p>
    <p>
      <a href="https://github.com/act-spec/act" target="_blank" rel="noopener noreferrer">Spec repo</a>
      · Apache-2.0 licensed
    </p>
  </footer>
`;

function mount(): void {
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('validator-web: #app root not found');
  }
  root.innerHTML = APP_HTML;

  wireTabs(root);
  wireUrlForm(root);
  wirePasteForm(root);
  wireFileForm(root);
  wireOutputDelegation(root);
}

function setMode(root: HTMLElement, mode: 'url' | 'paste' | 'file'): void {
  for (const tab of root.querySelectorAll<HTMLButtonElement>('.tab')) {
    const active = tab.dataset['mode'] === mode;
    tab.setAttribute('aria-selected', String(active));
  }
  for (const panel of root.querySelectorAll<HTMLElement>('[data-panel]')) {
    panel.classList.toggle('hidden', panel.dataset['panel'] !== mode);
  }
}

function wireTabs(root: HTMLElement): void {
  for (const tab of root.querySelectorAll<HTMLButtonElement>('.tab')) {
    tab.addEventListener('click', () => {
      const mode = tab.dataset['mode'];
      if (mode === 'url' || mode === 'paste' || mode === 'file') {
        setMode(root, mode);
      }
    });
  }
}

function showOutput(root: HTMLElement, html: string): void {
  const out = root.querySelector('#output');
  if (out) out.innerHTML = html;
}

function showLoading(root: HTMLElement, msg: string): void {
  showOutput(root, `<p class="loading">${escHtml(msg)}</p>`);
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function wireUrlForm(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>('#url-form');
  if (!form) return;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = form.querySelector<HTMLInputElement>('#url-input');
    const url = input?.value.trim() ?? '';
    if (!looksLikeUrl(url)) {
      showOutput(root, renderError('Please supply a valid http(s) URL.'));
      return;
    }
    showLoading(root, `Fetching ${url} …`);
    void (async () => {
      try {
        const outcome = await validateUrl(url);
        showOutput(
          root,
          renderUrlReport({
            report: outcome.report,
            corsBlocked: outcome.corsBlocked === true,
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showOutput(root, renderError(`Validation failed: ${msg}`));
      }
    })();
  });
}

function wirePasteForm(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>('#paste-form');
  if (!form) return;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const ta = form.querySelector<HTMLTextAreaElement>('#paste-input');
    const sel = form.querySelector<HTMLSelectElement>('#kind-override');
    const text = ta?.value ?? '';
    if (text.trim().length === 0) {
      showOutput(root, renderError('Paste a JSON envelope first.'));
      return;
    }
    const force = sel?.value || undefined;
    try {
      const outcome = validatePaste(
        text,
        force === 'manifest' || force === 'node' || force === 'index' ||
          force === 'ndjson' || force === 'subtree' || force === 'error'
          ? force
          : undefined,
      );
      showOutput(root, renderPasteResult(outcome));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showOutput(root, renderError(`Validation failed: ${msg}`));
    }
  });
}

function wireFileForm(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>('#file-form');
  if (!form) return;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = form.querySelector<HTMLInputElement>('#file-input');
    const file = input?.files?.[0];
    if (!file) {
      showOutput(root, renderError('Pick a file first.'));
      return;
    }
    showLoading(root, `Reading ${file.name} …`);
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      try {
        const outcome = validatePaste(text);
        showOutput(root, renderPasteResult(outcome));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showOutput(root, renderError(`Validation failed: ${msg}`));
      }
    });
    reader.addEventListener('error', () => {
      showOutput(root, renderError(`Could not read ${file.name}.`));
    });
    reader.readAsText(file);
  });
}

/** Delegate clicks on the "switch-to-paste" link in the CORS banner. */
function wireOutputDelegation(root: HTMLElement): void {
  const out = root.querySelector('#output');
  if (!out) return;
  out.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset['action'] === 'switch-to-paste') {
      setMode(root, 'paste');
      const ta = root.querySelector<HTMLTextAreaElement>('#paste-input');
      ta?.focus();
    }
  });
}

mount();
