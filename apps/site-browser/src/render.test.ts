// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  renderErrors,
  renderInitial,
  renderLoading,
  renderManifestHeader,
  renderNodeDetail,
  renderProgressiveTree,
  renderPayloadMeter,
  type TreeNode,
} from './render.js';
import type { ManifestEnvelope, SiteError } from './fetch.js';
import type { Gap, Warning } from '@act-spec/validator';

const baseManifest: ManifestEnvelope = {
  act_version: '0.1',
  site: { name: 'Test Site', description: 'A test site', locale: 'en-US' },
  index_url: '/act/index.json',
  node_url_template: '/act/nodes/{id}.json',
  conformance: { level: 'core' },
  delivery: 'static',
};

describe('renderInitial / renderLoading', () => {
  it('renderInitial mentions the example URL CTA', () => {
    const html = renderInitial();
    expect(html).toContain('data-action="set-url"');
    expect(html).toContain('localhost:4321');
  });

  it('renderLoading escapes the message', () => {
    expect(renderLoading('Loading <x>')).toContain('Loading &lt;x&gt;');
  });
});

describe('renderErrors', () => {
  it('returns empty when no errors', () => {
    expect(renderErrors([])).toBe('');
  });

  it('renders manifest-scope errors with no CORS banner', () => {
    const errors: SiteError[] = [{ scope: 'manifest', message: 'boom' }];
    const html = renderErrors(errors);
    expect(html).toContain('Could not load site');
    expect(html).toContain('boom');
    expect(html).not.toContain('cors-warning');
  });

  it('shows the cors-warning banner when any error is CORS-shaped', () => {
    const errors: SiteError[] = [
      { scope: 'manifest', message: 'fetch failed', cors: true },
    ];
    const html = renderErrors(errors);
    expect(html).toContain('cors-warning');
    expect(html).toContain('CORS');
  });
});

describe('renderManifestHeader', () => {
  it('shows site name, level, delivery and a PASS verdict when no gaps', () => {
    const html = renderManifestHeader(
      baseManifest,
      'https://x/.well-known/act.json',
    );
    expect(html).toContain('Test Site');
    expect(html).toContain('PASS');
    expect(html).toContain('verdict--ok');
    expect(html).toContain('core');
    expect(html).toContain('static');
  });

  it('wraps the manifest details in a collapsed <details> element', () => {
    const html = renderManifestHeader(
      baseManifest,
      'https://x/.well-known/act.json',
    );
    // Should be a <details> with class manifest-meta and NOT have `open`.
    expect(html).toMatch(/<details class="manifest-meta">/);
    expect(html).not.toMatch(/<details class="manifest-meta"[^>]*\sopen/);
    // The manifest URL stays in the summary so it's visible while collapsed.
    expect(html).toContain('Manifest details');
    expect(html).toContain('https://x/.well-known/act.json');
  });

  it('renders the three-line payload meter when meter input is supplied', () => {
    const html = renderManifestHeader(
      baseManifest,
      'https://x/.well-known/act.json',
      { meter: { walkBytes: 4096, walkLabel: 'manifest + 1 subtree' } },
    );
    expect(html).toContain('payload-meter');
    expect(html).toContain('payload-meter--multi');
    expect(html).toContain('ACT walk');
    expect(html).toContain('4.00 KB');
    expect(html).toContain('manifest + 1 subtree');
    // HTML row shown as placeholder until operator opts in.
    expect(html).toContain('HTML equivalent');
    expect(html).toContain('Estimate HTML cost');
    // Index row shown as placeholder until operator opts in.
    expect(html).toContain('Full index');
    expect(html).toContain('Show full index');
  });

  it('payload meter shows HTML row figure once estimated', () => {
    const html = renderManifestHeader(
      baseManifest,
      'https://x/.well-known/act.json',
      {
        meter: {
          walkBytes: 4096,
          walkLabel: 'manifest + 1 subtree + node',
          htmlBytes: 51200,
          htmlMeasured: { ok: 2, total: 2 },
        },
      },
    );
    expect(html).toContain('50.0 KB');
    expect(html).toContain('2 of 2 HTML pages');
  });

  it('payload meter marks HTML figure as ≥ when some pages are unmeasured', () => {
    const html = renderManifestHeader(
      baseManifest,
      'https://x/.well-known/act.json',
      {
        meter: {
          walkBytes: 4096,
          walkLabel: 'manifest + 1 subtree + node',
          htmlBytes: 12800,
          htmlMeasured: { ok: 1, total: 3 },
        },
      },
    );
    expect(html).toContain('≥');
    expect(html).toContain('1 of 3 HTML pages');
  });

  it('payload meter shows full-index row figure once opened', () => {
    const html = renderManifestHeader(
      baseManifest,
      'https://x/.well-known/act.json',
      {
        meter: {
          walkBytes: 4096,
          walkLabel: 'manifest + 1 subtree',
          indexBytes: 165632,
          indexEntryCount: 509,
        },
      },
    );
    expect(html).toMatch(/161\.\d KB/);
    expect(html).toContain('509 entries');
  });

  it('shows a gap-count chip when manifest gaps are present', () => {
    const gaps: Gap[] = [
      {
        requirement: 'PRD-100-R1',
        missing: 'site.id is required',
        level: 'core',
      },
    ];
    const html = renderManifestHeader(
      baseManifest,
      'https://x/.well-known/act.json',
      { manifestGaps: gaps },
    );
    expect(html).toContain('1 gap');
    expect(html).toContain('verdict--fail');
    expect(html).toContain('site.id is required');
  });
});

describe('renderProgressiveTree', () => {
  function nodeMap(): Map<string, TreeNode> {
    const m = new Map<string, TreeNode>();
    m.set('root', { id: 'root', type: 'site_root', title: 'Root', parent: null, children: ['a', 'b'], loaded: true, expanded: true });
    m.set('a', { id: 'a', type: 'page', title: 'A', parent: 'root', loaded: true, expanded: false });
    m.set('b', { id: 'b', type: 'page', title: 'B', parent: 'root', loaded: false, expanded: false });
    return m;
  }

  it('marks the selected row with the selected class', () => {
    const html = renderProgressiveTree(nodeMap(), 'root', {
      selectedId: 'a',
      expandedIds: new Set(['root']),
    });
    expect(html).toContain('tree__item--selected');
    expect(html).toContain('data-node-id="a"');
  });

  it('shows a stub chip for unloaded nodes discovered via parent.children[]', () => {
    const html = renderProgressiveTree(nodeMap(), 'root', {
      selectedId: null,
      expandedIds: new Set(['root']),
    });
    expect(html).toContain('stub');
  });

  it('hides children when the parent is not in expandedIds', () => {
    const html = renderProgressiveTree(nodeMap(), 'root', {
      selectedId: null,
      expandedIds: new Set(),
    });
    expect(html).toContain('data-node-id="root"');
    expect(html).not.toContain('data-node-id="a"');
    expect(html).not.toContain('data-node-id="b"');
  });

  it('annotates rows on the walk path with a class', () => {
    const html = renderProgressiveTree(nodeMap(), 'root', {
      selectedId: 'a',
      expandedIds: new Set(['root']),
      walkPath: ['root', 'a'],
    });
    expect(html).toContain('tree__item--on-walk');
  });

  it('returns empty-state when node map is empty', () => {
    expect(
      renderProgressiveTree(new Map(), 'root', { selectedId: null, expandedIds: new Set() }),
    ).toContain('Manifest loaded');
  });
});

describe('renderPayloadMeter', () => {
  it('renders a placeholder for HTML when not yet estimated', () => {
    const html = renderPayloadMeter({ walkBytes: 1000, walkLabel: 'manifest' });
    expect(html).toContain('Estimate HTML cost');
    expect(html).toContain('Show full index');
  });

  it('renders the HTML row with byte/token figures when measured', () => {
    const html = renderPayloadMeter({
      walkBytes: 1000,
      walkLabel: 'manifest + 1 subtree + node',
      htmlBytes: 8192,
      htmlMeasured: { ok: 1, total: 1 },
    });
    expect(html).toContain('8.00 KB');
    expect(html).not.toContain('Estimate HTML cost');
  });

  it('renders savings badges on the ACT walk row when HTML estimate is on (ACT is smaller)', () => {
    const html = renderPayloadMeter({
      walkBytes: 25000,
      walkGzipBytes: 4000,
      walkLabel: 'manifest + 2 subtrees + node',
      htmlBytes: 100000,
      htmlGzipBytes: 16000,
      htmlMeasured: { ok: 3, total: 3 },
    });
    // ACT walk is 25% the size → 75% savings → green ↓ badge.
    expect(html).toMatch(/payload-meter__delta--save[^>]*>↓ 75%/);
    expect(html).not.toContain('payload-meter__delta--cost');
  });

  it('renders cost badges (red ↑) when ACT walk exceeds HTML', () => {
    const html = renderPayloadMeter({
      walkBytes: 200000,
      walkLabel: 'manifest + 5 subtrees + node',
      htmlBytes: 100000,
      htmlMeasured: { ok: 1, total: 1 },
    });
    // ACT walk is 2× HTML → 100% larger → red ↑ badge.
    expect(html).toMatch(/payload-meter__delta--cost[^>]*>↑ 100%/);
  });

  it('omits delta badges when HTML estimate is not yet requested', () => {
    const html = renderPayloadMeter({ walkBytes: 25000, walkLabel: 'manifest' });
    expect(html).not.toContain('payload-meter__delta');
  });
});

describe('renderNodeDetail', () => {
  it('renders prose markdown via marked (bold becomes <strong>)', () => {
    const node = {
      id: 'p',
      type: 'page',
      title: 'P',
      content: [{ type: 'prose', text: 'hello **world**' }],
    };
    const html = renderNodeDetail(node);
    expect(html).toContain('block--prose');
    expect(html).toContain('<strong>world</strong>');
  });

  it('renders a data block as a JSON pre with the payload keys', () => {
    const node = {
      id: 'd',
      type: 'page',
      content: [{ type: 'data', payload: { sku: 'A1', price: 10 } }],
    };
    const html = renderNodeDetail(node);
    expect(html).toContain('block--data');
    expect(html).toContain('<pre');
    expect(html).toContain('sku');
    expect(html).toContain('A1');
  });

  it('renders a callout block with the level class', () => {
    const node = {
      id: 'c',
      type: 'page',
      content: [{ type: 'callout', level: 'warning', text: 'careful' }],
    };
    const html = renderNodeDetail(node);
    expect(html).toContain('block--callout');
    expect(html).toContain('block--callout--warning');
  });

  it('renders related[] as goto-node chips', () => {
    const node = {
      id: 'x',
      type: 'page',
      related: [{ id: 'y', relation: 'sibling' }],
    };
    const html = renderNodeDetail(node);
    expect(html).toContain('data-action="goto-node"');
    expect(html).toContain('data-id="y"');
    expect(html).toContain('sibling');
  });

  it('renders provenance chips with locale, fallback translation, and adapter', () => {
    const node = {
      id: 'q',
      type: 'page',
      metadata: {
        locale: 'fr-FR',
        translation_status: 'fallback',
        source: { adapter: 'act-markdown', source_id: 'docs/q.md' },
      },
    };
    const html = renderNodeDetail(node);
    expect(html).toContain('locale: fr-FR');
    expect(html).toContain('translation: fallback');
    expect(html).toContain('adapter: act-markdown');
    // fallback uses chip--warn while the others are chip--mute.
    expect(html).toMatch(/<span class="chip chip--warn">translation: fallback/);
  });

  it('shows a gap strip when validator gaps are present', () => {
    const gaps: Gap[] = [
      { requirement: 'PRD-100-R3', missing: 'no etag', level: 'core' },
    ];
    const warnings: Warning[] = [];
    const html = renderNodeDetail({ id: 'n', type: 'page' }, gaps, warnings);
    expect(html).toContain('node-findings');
    expect(html).toContain('no etag');
    expect(html).toContain('1 gap');
  });

  it('returns a placeholder when no node is supplied', () => {
    expect(renderNodeDetail(null)).toContain('Select a node');
  });
});
