/**
 * `/llms.txt` emitter tests — ACT v0.2 §3.4 / §3.5 / §6.40.
 */
import { describe, expect, it } from 'vitest';
import type { IndexSchema, ManifestSchema, NodeSchema } from '@act-spec/core';

import { emitLlmsTxt } from './llms-txt.js';

function manifest(over: Partial<ManifestSchema.Manifest> = {}): ManifestSchema.Manifest {
  return {
    act_version: '0.1',
    site: { name: 'Acme Docs', description: 'Docs for the Acme platform.', canonical_url: 'https://docs.acme.test/' },
    index_url: '/act/index.json',
    node_url_template: '/act/nodes/{id}.json',
    conformance: { level: 'core' },
    delivery: 'static',
    ...over,
  };
}

function entry(over: Partial<IndexSchema.IndexEntry>): IndexSchema.IndexEntry {
  return {
    id: 'sample',
    type: 'article',
    title: 'Sample',
    summary: 'A sample node.',
    tokens: { summary: 4 },
    etag: 's256:abc',
    ...over,
  };
}

function node(over: Partial<NodeSchema.Node>): NodeSchema.Node {
  return {
    act_version: '0.1',
    id: 'sample',
    type: 'article',
    title: 'Sample',
    etag: 's256:abc',
    summary: 'A sample node.',
    content: [],
    tokens: { summary: 4 },
    ...over,
  };
}

describe('emitLlmsTxt', () => {
  it('emits H1 site name + blockquote summary + H2 type sections (canonical llms.txt format)', () => {
    const m = manifest();
    const idx: IndexSchema.Index = {
      act_version: '0.1',
      nodes: [
        entry({ id: 'intro', type: 'article', title: 'Introduction', summary: 'High-level overview.' }),
        entry({ id: 'api/users', type: 'api', title: 'Users API', summary: 'Manage users.' }),
        entry({ id: 'api/orders', type: 'api', title: 'Orders API', summary: 'Manage orders.' }),
        entry({ id: 'concepts/auth', type: 'concept', title: 'Auth', summary: 'Authentication concepts.' }),
      ],
      etag: 's256:idx',
    };
    const out = emitLlmsTxt(m, idx);

    expect(out).toMatch(/^# Acme Docs\n/);
    expect(out).toContain('> Docs for the Acme platform.');
    expect(out).toContain('## Articles');
    expect(out).toContain('## API endpoints');
    expect(out).toContain('## Concepts');
    expect(out).toMatch(
      /- \[Introduction\]\(https:\/\/docs\.acme\.test\/act\/nodes\/intro\.json\): High-level overview\./,
    );
    expect(out.endsWith('\n')).toBe(true);
  });

  it('snapshot — flat (single-locale) output', () => {
    const m = manifest({
      site: { name: 'Acme', description: 'All things Acme.', canonical_url: 'https://x.test' },
    });
    const idx: IndexSchema.Index = {
      act_version: '0.1',
      nodes: [
        entry({ id: 'a', type: 'article', title: 'Alpha', summary: 'First.' }),
        entry({ id: 'b', type: 'article', title: 'Beta', summary: 'Second.' }),
      ],
      etag: 's256:idx',
    };
    expect(emitLlmsTxt(m, idx)).toMatchInlineSnapshot(`
      "# Acme

      > All things Acme.

      ## Articles

      - [Alpha](https://x.test/act/nodes/a.json): First.
      - [Beta](https://x.test/act/nodes/b.json): Second.
      "
    `);
  });

  it('groups by locale when >1 distinct locale present', () => {
    const m = manifest();
    const idx: IndexSchema.Index = {
      act_version: '0.1',
      nodes: [
        entry({ id: 'a-en', type: 'article', title: 'Alpha (EN)' }),
        entry({ id: 'a-es', type: 'article', title: 'Alpha (ES)' }),
      ],
      etag: 's256:idx',
    };
    const nodes: NodeSchema.Node[] = [
      node({ id: 'a-en', title: 'Alpha (EN)', metadata: { locale: 'en-US' } }),
      node({ id: 'a-es', title: 'Alpha (ES)', metadata: { locale: 'es-ES' } }),
    ];
    const out = emitLlmsTxt(m, idx, { nodes });
    expect(out).toContain('## en-US');
    expect(out).toContain('## es-ES');
    expect(out).toContain('### Articles');
  });

  it('skips nodes with hidden=true (top-level or metadata)', () => {
    const m = manifest();
    const idx: IndexSchema.Index = {
      act_version: '0.1',
      nodes: [
        entry({ id: 'shown', title: 'Shown' }),
        entry({ id: 'hidden-top', title: 'Hidden Top' }),
        entry({ id: 'hidden-meta', title: 'Hidden Meta' }),
      ],
      etag: 's256:idx',
    };
    const nodes: NodeSchema.Node[] = [
      node({ id: 'shown', title: 'Shown' }),
      node({ id: 'hidden-top', title: 'Hidden Top', hidden: true } as unknown as NodeSchema.Node),
      node({ id: 'hidden-meta', title: 'Hidden Meta', metadata: { hidden: true } }),
    ];
    const out = emitLlmsTxt(m, idx, { nodes });
    expect(out).toContain('Shown');
    expect(out).not.toContain('Hidden Top');
    expect(out).not.toContain('Hidden Meta');
  });

  it('uses node.source.human_url when provided (preferred over /act/nodes/<id>.json)', () => {
    const m = manifest();
    const idx: IndexSchema.Index = {
      act_version: '0.1',
      nodes: [entry({ id: 'a', title: 'Alpha' })],
      etag: 's256:idx',
    };
    const nodes: NodeSchema.Node[] = [
      node({ id: 'a', title: 'Alpha', source: { human_url: '/posts/alpha' } }),
    ];
    const out = emitLlmsTxt(m, idx, { nodes });
    expect(out).toContain('(https://docs.acme.test/posts/alpha)');
    expect(out).not.toContain('act/nodes/a.json');
  });

  it('emits relative URLs when canonical_url is absent', () => {
    const m = manifest({
      site: { name: 'Local', description: 'No origin.' },
    });
    const idx: IndexSchema.Index = {
      act_version: '0.1',
      nodes: [entry({ id: 'a', title: 'Alpha' })],
      etag: 's256:idx',
    };
    const out = emitLlmsTxt(m, idx);
    expect(out).toContain('(/act/nodes/a.json)');
  });

  it('truncates long summaries cleanly with ellipsis', () => {
    const m = manifest();
    const longSummary = 'word '.repeat(50).trim();
    const idx: IndexSchema.Index = {
      act_version: '0.1',
      nodes: [entry({ id: 'a', title: 'A', summary: longSummary })],
      etag: 's256:idx',
    };
    const out = emitLlmsTxt(m, idx);
    expect(out).toMatch(/…/);
  });
});
