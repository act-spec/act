/**
 * The inspector NEVER ships its own parser; PRD-601-R1 pins
 * @act-spec/validator as the single source of truth. These tests
 * verify the wrapper's `findings` translation and the structural
 * "value is null on hard error" contract.
 */
import { describe, expect, it } from 'vitest';
import { parseManifest, parseIndex, parseNode, parseSubtree, parseNdjsonIndex } from './parsers.js';

describe('parseManifest (PRD-601-R1)', () => {
  it('returns the parsed value when the envelope is structurally valid', () => {
    const m = {
      act_version: '0.1',
      site: { name: 'fixture' },
      delivery: 'static',
      conformance: { level: 'core' },
      index_url: '/act/index.json',
      node_url_template: '/act/n/{id}.json',
    };
    const r = parseManifest(m);
    expect(r.value).not.toBeNull();
    expect(r.findings.filter((f) => f.severity === 'error')).toHaveLength(0);
  });

  it('returns value: null and an envelope-* finding when the body is invalid', () => {
    const r = parseManifest({ not: 'a manifest' });
    expect(r.value).toBeNull();
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings[0]?.code.startsWith('envelope-')).toBe(true);
  });
});

describe('parseIndex (PRD-601-R1)', () => {
  it('parses a structurally valid index', () => {
    const r = parseIndex({ act_version: '0.1', nodes: [] });
    expect(r.value).not.toBeNull();
  });

  it('returns null + findings on a malformed index', () => {
    const r = parseIndex({ act_version: '0.1' });
    expect(r.value).toBeNull();
    expect(r.findings.length).toBeGreaterThan(0);
  });
});

describe('parseNode (PRD-601-R1)', () => {
  it('parses a structurally valid node', () => {
    const r = parseNode({
      act_version: '0.1',
      id: 'foo',
      type: 'page',
      title: 'Foo',
      summary: 'foo summary',
      content: [],
      tokens: { summary: 5 },
      etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(r.value).not.toBeNull();
  });

  it('returns null + findings on a malformed node', () => {
    const r = parseNode({ id: 'no-version' });
    expect(r.value).toBeNull();
    expect(r.findings.length).toBeGreaterThan(0);
  });
});

describe('parseSubtree (PRD-601-R1)', () => {
  it('parses a structurally valid subtree', () => {
    const r = parseSubtree({
      act_version: '0.1',
      root: 'foo',
      etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
      depth: 1,
      nodes: [
        {
          act_version: '0.1',
          id: 'foo',
          type: 'page',
          title: 'Foo',
          summary: 'foo summary',
          content: [],
          tokens: { summary: 5 },
          etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
        },
      ],
    });
    expect(r.value).not.toBeNull();
  });

  it('returns null + findings on a malformed subtree', () => {
    const r = parseSubtree({});
    expect(r.value).toBeNull();
    expect(r.findings.length).toBeGreaterThan(0);
  });
});

describe('parseNdjsonIndex (PRD-601-R1 / R19)', () => {
  it('parses a structurally valid ndjson body', () => {
    const lines = [
      JSON.stringify({
        id: 'foo',
        type: 'page',
        title: 'Foo',
        summary: 'foo summary',
        tokens: { summary: 5 },
        etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
      }),
    ].join('\n');
    const r = parseNdjsonIndex(lines);
    expect(r.value).not.toBeNull();
  });

  it('returns null + findings on a malformed ndjson body', () => {
    const r = parseNdjsonIndex('not json\nstill not json');
    expect(r.value).toBeNull();
    expect(r.findings.length).toBeGreaterThan(0);
  });
});
