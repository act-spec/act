/**
 * `/llms-full.txt` emitter tests — ACT v0.2 §3.4 / §3.5 / §6.40.
 */
import { describe, expect, it } from 'vitest';
import type { IndexSchema, ManifestSchema, NodeSchema } from '@act-spec/core';

import {
  DEFAULT_LLMS_FULL_MAX_BYTES,
  emitLlmsFullTxt,
  nodeFetcherFromArray,
  renderBlockToMarkdown,
} from './llms-full-txt.js';

function manifest(): ManifestSchema.Manifest {
  return {
    act_version: '0.1',
    site: { name: 'Acme Docs', description: 'Docs.', canonical_url: 'https://docs.acme.test' },
    index_url: '/act/index.json',
    node_url_template: '/act/nodes/{id}.json',
    conformance: { level: 'core' },
    delivery: 'static',
  };
}

function entry(over: Partial<{ id: string; type: string; title: string; summary: string }>): {
  id: string;
  type: string;
  title: string;
  summary: string;
  tokens: { summary: number };
  etag: string;
} {
  return {
    id: 'sample',
    type: 'article',
    title: 'Sample',
    summary: 'A sample.',
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
    summary: 'A sample.',
    content: [],
    tokens: { summary: 4 },
    ...over,
  };
}

describe('renderBlockToMarkdown', () => {
  it('markdown / prose pass through verbatim', () => {
    expect(renderBlockToMarkdown({ type: 'markdown', text: '# Hello\n\nWorld.' })).toBe('# Hello\n\nWorld.');
    expect(renderBlockToMarkdown({ type: 'prose', text: 'Plain words.' })).toBe('Plain words.');
  });

  it('heading uses level 1-6, default 2', () => {
    expect(renderBlockToMarkdown({ type: 'heading', text: 'Title', level: 1 })).toBe('# Title');
    expect(renderBlockToMarkdown({ type: 'heading', text: 'Sub', level: 3 })).toBe('### Sub');
    expect(renderBlockToMarkdown({ type: 'heading', text: 'Bare' })).toBe('## Bare');
  });

  it('code block fenced with language + filename', () => {
    expect(renderBlockToMarkdown({ type: 'code', language: 'ts', text: 'const x = 1;' })).toBe(
      '```ts\nconst x = 1;\n```',
    );
    expect(
      renderBlockToMarkdown({ type: 'code', language: 'js', text: 'x', filename: 'app.js' }),
    ).toBe('```js title="app.js"\nx\n```');
  });

  it('callout becomes blockquote with prefix', () => {
    const out = renderBlockToMarkdown({ type: 'callout', level: 'warning', text: 'Be careful.\nSeriously.' });
    expect(out).toContain('> [WARNING]');
    expect(out).toContain('> Be careful.');
    expect(out).toContain('> Seriously.');
  });

  it('list — unordered + ordered', () => {
    const ul = renderBlockToMarkdown({ type: 'list', items: ['a', 'b', 'c'] });
    expect(ul).toBe('- a\n- b\n- c');
    const ol = renderBlockToMarkdown({ type: 'list', ordered: true, items: ['a', 'b'] });
    expect(ol).toBe('1. a\n2. b');
  });

  it('table — markdown pipe table', () => {
    const out = renderBlockToMarkdown({
      type: 'table',
      headers: ['Name', 'Type'],
      rows: [
        ['id', 'string'],
        ['count', 'number'],
      ],
    });
    expect(out).toContain('| Name | Type |');
    expect(out).toContain('| --- | --- |');
    expect(out).toContain('| id | string |');
  });

  it('data block fenced with format as language', () => {
    const out = renderBlockToMarkdown({ type: 'data', format: 'json', text: '{"x":1}' });
    expect(out).toBe('```json\n{"x":1}\n```');
  });

  it('unknown / component / marketing:* → opaque comment', () => {
    expect(renderBlockToMarkdown({ type: 'marketing:hero' })).toBe('<!-- component: marketing:hero -->');
    expect(renderBlockToMarkdown({ type: 'unknown-thing' })).toBe('<!-- component: unknown-thing -->');
  });
});

describe('emitLlmsFullTxt', () => {
  it('emits site header, frontmatter for each leaf, and `---` separators', async () => {
    const m = manifest();
    const idx = {
      act_version: '0.1',
      nodes: [entry({ id: 'a', title: 'Alpha' }), entry({ id: 'b', title: 'Beta', type: 'concept' })],
      etag: 's256:i',
    };
    const nodes: NodeSchema.Node[] = [
      node({
        id: 'a',
        title: 'Alpha',
        type: 'article',
        content: [{ type: 'markdown', text: 'Body of Alpha.' }],
      }),
      node({
        id: 'b',
        title: 'Beta',
        type: 'concept',
        content: [{ type: 'markdown', text: 'Body of Beta.' }],
      }),
    ];
    const out = await emitLlmsFullTxt(m, idx, nodeFetcherFromArray(nodes));
    expect(out).toMatch(/^# Acme Docs\n/);
    expect(out).toContain('> Docs.');
    expect(out).toContain('---\ntitle: Alpha');
    expect(out).toContain('url: https://docs.acme.test/act/nodes/a.json');
    expect(out).toContain('type: article');
    expect(out).toContain('Body of Alpha.');
    expect(out).toContain('---\ntitle: Beta');
    expect(out).toContain('Body of Beta.');
    // YAML frontmatter for each leaf opens & closes with `---`.
    const dashLines = out.split('\n').filter((ln) => ln === '---');
    expect(dashLines.length).toBeGreaterThanOrEqual(4);
  });

  it('skips hidden nodes', async () => {
    const m = manifest();
    const idx = {
      act_version: '0.1',
      nodes: [entry({ id: 'a' }), entry({ id: 'h' })],
      etag: 's256:i',
    };
    const nodes: NodeSchema.Node[] = [
      node({ id: 'a', title: 'Alpha', content: [{ type: 'markdown', text: 'Visible.' }] }),
      node({
        id: 'h',
        title: 'Hidden',
        metadata: { hidden: true },
        content: [{ type: 'markdown', text: 'SECRET.' }],
      }),
    ];
    const out = await emitLlmsFullTxt(m, idx, nodeFetcherFromArray(nodes));
    expect(out).toContain('Visible.');
    expect(out).not.toContain('SECRET.');
    expect(out).not.toContain('Hidden');
  });

  it('skips inner branch nodes that have no body', async () => {
    const m = manifest();
    const idx = {
      act_version: '0.1',
      nodes: [entry({ id: 'parent' }), entry({ id: 'leaf' })],
      etag: 's256:i',
    };
    const nodes: NodeSchema.Node[] = [
      node({ id: 'parent', title: 'Parent', children: ['leaf'], content: [] }),
      node({ id: 'leaf', title: 'Leaf', parent: 'parent', content: [{ type: 'markdown', text: 'Leafy.' }] }),
    ];
    const out = await emitLlmsFullTxt(m, idx, nodeFetcherFromArray(nodes));
    expect(out).toContain('Leafy.');
    expect(out).not.toContain('title: Parent');
  });

  it('respects maxBytes — truncates with marker, BFS by index order', async () => {
    const m = manifest();
    const big = 'x'.repeat(2000);
    const idx = {
      act_version: '0.1',
      nodes: [
        entry({ id: 'a', title: 'A' }),
        entry({ id: 'b', title: 'B' }),
        entry({ id: 'c', title: 'C' }),
      ],
      etag: 's256:i',
    };
    const nodes: NodeSchema.Node[] = [
      node({ id: 'a', title: 'A', content: [{ type: 'markdown', text: big }] }),
      node({ id: 'b', title: 'B', content: [{ type: 'markdown', text: big }] }),
      node({ id: 'c', title: 'C', content: [{ type: 'markdown', text: big }] }),
    ];
    const out = await emitLlmsFullTxt(m, idx, nodeFetcherFromArray(nodes), { maxBytes: 2500 });
    expect(out).toMatch(/<!-- truncated at \d+ bytes \(max 2500\) -->/);
    expect(out).toContain('title: A');
    // C should not have been included.
    expect(out).not.toContain('title: C');
  });

  it('default maxBytes constant matches 5 MB', () => {
    expect(DEFAULT_LLMS_FULL_MAX_BYTES).toBe(5_000_000);
  });

  it('skips nodes that the fetcher returns undefined for', async () => {
    const m = manifest();
    const idx = {
      act_version: '0.1',
      nodes: [entry({ id: 'missing' }), entry({ id: 'present' })],
      etag: 's256:i',
    };
    const nodes: NodeSchema.Node[] = [
      node({ id: 'present', title: 'Present', content: [{ type: 'markdown', text: 'OK.' }] }),
    ];
    const out = await emitLlmsFullTxt(m, idx, nodeFetcherFromArray(nodes));
    expect(out).toContain('Present');
    expect(out).not.toContain('missing');
  });
});
