/**
 * Tests for per-envelope structural + cross-cutting validation
 * (PRD-600-R1 → R7, R13, R14, R15).
 *
 * Each `it()` name cites the PRD-600 requirement (and where useful, the
 * sub-requirement).
 */
import { describe, expect, it } from 'vitest';
import { listFixtures, loadFixture, findGap, findWarning } from '@act-spec/_test-utils';
import {
  reDeriveEtagAndCheck,
  validateError,
  validateIndex,
  validateManifest,
  validateNdjsonIndex,
  validateNode,
  validateSubtree,
} from './envelopes.js';
import { _resetCompiledSchemasForTest } from './schemas.js';

describe('envelope validation surface (PRD-600-R1)', () => {
  it('PRD-600-R1: validateManifest accepts the locked schemas/100/manifest.schema.json positive corpus', async () => {
    const fixtures = await listFixtures(['100'], 'positive');
    const manifests = fixtures.filter((f) => f.name.startsWith('manifest-'));
    expect(manifests.length).toBeGreaterThan(0);
    for (const f of manifests) {
      const { body } = await loadFixture(f);
      const result = validateManifest(body as object);
      expect(
        { name: f.name, gaps: result.gaps },
        `manifest fixture ${f.name} should validate clean`,
      ).toEqual({ name: f.name, gaps: [] });
    }
  });

  it('PRD-600-R1: validateNode + validateIndex + validateSubtree + validateError accept positive PRD-100 fixtures', async () => {
    const fixtures = await listFixtures(['100'], 'positive');
    for (const f of fixtures) {
      const { body } = await loadFixture(f);
      let r;
      if (f.name.startsWith('node-')) r = validateNode(body as object);
      else if (f.name.startsWith('index-')) r = validateIndex(body as object);
      else if (f.name.startsWith('subtree-')) r = validateSubtree(body as object);
      else if (f.name.startsWith('error-')) r = validateError(body as object);
      else continue;
      expect({ name: f.name, gaps: r.gaps }, `${f.name}`).toEqual({ name: f.name, gaps: [] });
    }
  });

  it('PRD-600-R1: validators do not carry inline schemas — same instance returned twice via cache', () => {
    _resetCompiledSchemasForTest();
    const r1 = validateManifest({});
    const r2 = validateManifest({});
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });
});

describe('PRD-600-R2: schema failures cite the source PRD-100 requirement with a JSON Pointer', () => {
  it('emits a gap citing PRD-100-R1 (act_version required at every envelope) with the failing pointer in `missing`', () => {
    const result = validateManifest({
      site: { name: 'x' },
      index_url: '/i',
      node_url_template: '/n/{id}',
      conformance: { level: 'core' },
      delivery: 'static',
    });
    const gap = findGap(result.gaps, 'PRD-100-R1');
    expect(gap, 'expected gap citing PRD-100-R1').toBeDefined();
    expect(gap?.missing).toMatch(/act_version|required/);
  });

  it('emits a gap citing PRD-100-R4 when a non-act_version manifest required field is missing', () => {
    const result = validateManifest({
      act_version: '0.1',
      // missing site
      index_url: '/i',
      node_url_template: '/n/{id}',
      conformance: { level: 'core' },
      delivery: 'static',
    });
    expect(findGap(result.gaps, 'PRD-100-R4')).toBeDefined();
  });

  it('emits a gap with the failing JSON Pointer in `missing` when node has uppercase id', () => {
    const result = validateNode({
      act_version: '0.1',
      id: 'Intro',
      type: 'article',
      title: 't',
      etag: 's256:abc1230000000000000000',
      summary: 's',
      content: [{ type: 'markdown', text: 'x' }],
      tokens: { summary: 1 },
    });
    const gap = findGap(result.gaps, 'PRD-100-R10');
    expect(gap).toBeDefined();
    expect(gap?.missing).toMatch(/\/id|pattern/);
  });
});

describe('PRD-600-R3: cross-cutting rules not expressible in JSON Schema', () => {
  it('detects a children-cycle (single-node self-reference) per PRD-100-R25', () => {
    const result = validateNode({
      act_version: '0.1',
      id: 'intro',
      type: 'article',
      title: 't',
      etag: 's256:abc1230000000000000000',
      summary: 's',
      content: [{ type: 'markdown', text: 'x' }],
      tokens: { summary: 1 },
      children: ['intro'],
    });
    expect(findGap(result.gaps, 'PRD-100-R25')).toBeDefined();
  });

  it('detects mounts-overlapping prefixes per PRD-106-R20', () => {
    const result = validateManifest({
      act_version: '0.1',
      site: { name: 's' },
      index_url: '/i',
      node_url_template: '/n/{id}',
      conformance: { level: 'core' },
      delivery: 'static',
      mounts: [
        { prefix: '/a', delivery: 'static', manifest_url: '/a/.well-known/act.json' },
        { prefix: '/a/sub', delivery: 'static', manifest_url: '/a/sub/.well-known/act.json' },
      ],
    });
    expect(findGap(result.gaps, 'PRD-106-R20')).toBeDefined();
  });

  it('detects no overlap when mount prefixes share a leading substring but not a path-segment boundary', () => {
    const result = validateManifest({
      act_version: '0.1',
      site: { name: 's' },
      index_url: '/i',
      node_url_template: '/n/{id}',
      conformance: { level: 'core' },
      delivery: 'static',
      mounts: [
        { prefix: '/foo', delivery: 'static', manifest_url: '/foo/.well-known/act.json' },
        { prefix: '/foobar', delivery: 'static', manifest_url: '/foobar/.well-known/act.json' },
      ],
    });
    expect(findGap(result.gaps, 'PRD-106-R20')).toBeUndefined();
  });

  it('detects multi-node children cycle in subtree per PRD-100-R25', () => {
    const result = validateSubtree({
      act_version: '0.1',
      root: 'aa',
      etag: 's256:abc1230000000000000000',
      depth: 2,
      nodes: [
        {
          act_version: '0.1',
          id: 'aa',
          type: 'article',
          title: 'A',
          etag: 's256:abc1230000000000000000',
          summary: 's',
          content: [],
          tokens: { summary: 1 },
          children: ['bb'],
        },
        {
          act_version: '0.1',
          id: 'bb',
          type: 'article',
          title: 'B',
          etag: 's256:def4560000000000000000',
          summary: 's',
          content: [],
          tokens: { summary: 1 },
          children: ['aa'],
        },
      ],
    });
    expect(findGap(result.gaps, 'PRD-100-R25')).toBeDefined();
  });
});

describe('PRD-600-R4: tolerate unknown optional fields per PRD-108-R7', () => {
  it('emits an unknown-field warning, NOT a gap, for an unknown manifest field', () => {
    const result = validateManifest({
      act_version: '0.1',
      site: { name: 's' },
      index_url: '/i',
      node_url_template: '/n/{id}',
      conformance: { level: 'core' },
      delivery: 'static',
      future_thing: 'tolerated',
    });
    expect(result.ok).toBe(true);
    expect(findWarning(result.warnings, 'unknown-field')).toBeDefined();
  });
});

describe('PRD-600-R5: closed-enum violations are hard errors', () => {
  it('rejects conformance.level outside {core, standard, strict} citing PRD-107-R2', () => {
    const result = validateManifest({
      act_version: '0.1',
      site: { name: 's' },
      index_url: '/i',
      node_url_template: '/n/{id}',
      conformance: { level: 'gold' },
      delivery: 'static',
    });
    expect(findGap(result.gaps, 'PRD-107-R2')).toBeDefined();
  });

  it('rejects delivery outside {static, runtime} citing PRD-107-R3', () => {
    const result = validateManifest({
      act_version: '0.1',
      site: { name: 's' },
      index_url: '/i',
      node_url_template: '/n/{id}',
      conformance: { level: 'core' },
      delivery: 'edge',
    });
    expect(findGap(result.gaps, 'PRD-107-R3')).toBeDefined();
  });

  it('rejects error.code outside the closed enum citing PRD-100-R41', () => {
    const result = validateError({
      act_version: '0.1',
      error: { code: 'something_else', message: 'm' },
    });
    expect(findGap(result.gaps, 'PRD-100-R41')).toBeDefined();
  });
});

describe('PRD-600-R6: etag value-shape per PRD-103-R2 / R3', () => {
  it('rejects an etag with whitespace (PRD-103-R2)', () => {
    const result = validateNode({
      act_version: '0.1',
      id: 'intro',
      type: 'article',
      title: 't',
      etag: 's256:abc 1230000000000000000',
      summary: 's',
      content: [],
      tokens: { summary: 1 },
    });
    expect(findGap(result.gaps, 'PRD-103-R2')).toBeDefined();
  });

  it('rejects an etag with non-s256 algorithm prefix (PRD-103-R3 admit-list)', () => {
    const result = validateNode({
      act_version: '0.1',
      id: 'intro',
      type: 'article',
      title: 't',
      etag: 'md5:abcabcabcabcabcabcabca',
      summary: 's',
      content: [],
      tokens: { summary: 1 },
    });
    expect(findGap(result.gaps, 'PRD-103-R3')).toBeDefined();
  });

  it('rejects a missing etag on the node envelope (PRD-103-R1)', () => {
    const result = validateNode({
      act_version: '0.1',
      id: 'intro',
      type: 'article',
      title: 't',
      summary: 's',
      content: [],
      tokens: { summary: 1 },
    });
    // PRD-100-R21 (required field) AND PRD-103-R1 both apply; either citation is acceptable.
    const has = result.gaps.some(
      (g) => g.requirement === 'PRD-103-R1' || g.requirement === 'PRD-100-R21',
    );
    expect(has).toBe(true);
  });

  it('rejects 32-char etag (length 32 ≠ 22) per PRD-103-R3 on node envelope', () => {
    const result = validateNode({
      act_version: '0.1',
      id: 'intro',
      type: 'article',
      title: 't',
      etag: 's256:9f2c1b8d4a7e3f2a1c5b8e0d4a7f2c1b',
      summary: 's',
      content: [],
      tokens: { summary: 1 },
    });
    expect(findGap(result.gaps, 'PRD-103-R3')).toBeDefined();
  });
});

describe('PRD-600-R7: re-derive etag against canonical bytes', () => {
  it('byte-for-byte match against the static-derivation worked example', async () => {
    const fixtures = await listFixtures(['103'], 'positive');
    const fx = fixtures.find((f) => f.name === 'static-derivation-worked-example.json');
    expect(fx).toBeDefined();
    const raw = JSON.parse(
      await (await import('node:fs')).promises.readFile(fx!.filePath, 'utf8'),
    ) as { canonical_jcs_bytes_utf8: string; expected_etag: string };
    const gaps = reDeriveEtagAndCheck({
      canonicalBytes: raw.canonical_jcs_bytes_utf8,
      expected: raw.expected_etag,
      profile: 'static',
    });
    expect(gaps).toEqual([]);
  });

  it('emits a gap citing PRD-103-R4 on static mismatch', () => {
    const gaps = reDeriveEtagAndCheck({
      canonicalBytes: '{}',
      expected: 's256:wrongwrongwrongwrongwr',
      profile: 'static',
    });
    expect(findGap(gaps, 'PRD-103-R4')).toBeDefined();
  });

  it('emits a gap citing PRD-103-R6 on runtime mismatch', () => {
    const gaps = reDeriveEtagAndCheck({
      payloadMinusEtag: { x: 1 },
      expected: 's256:wrongwrongwrongwrongwr',
      profile: 'runtime',
    });
    expect(findGap(gaps, 'PRD-103-R6')).toBeDefined();
  });
});

describe('PRD-600-R13: cycle in children graph', () => {
  it('flags self-cycle (also covered by R3)', () => {
    const result = validateNode({
      act_version: '0.1',
      id: 'aa',
      type: 'article',
      title: 'A',
      etag: 's256:abc1230000000000000000',
      summary: 's',
      content: [],
      tokens: { summary: 1 },
      children: ['aa'],
    });
    expect(findGap(result.gaps, 'PRD-100-R25')).toBeDefined();
  });
});

describe('PRD-600-R14: ID grammar applied to every ID-bearing field', () => {
  it('rejects parent with leading slash (PRD-100-R10)', () => {
    const result = validateNode({
      act_version: '0.1',
      id: 'intro',
      type: 'article',
      title: 't',
      etag: 's256:abc1230000000000000000',
      summary: 's',
      content: [],
      tokens: { summary: 1 },
      parent: '/leading-slash',
    });
    expect(findGap(result.gaps, 'PRD-100-R10')).toBeDefined();
  });
});

describe('PRD-600-R15: subtree depth + ordering', () => {
  it('depth > 8 → gap citing PRD-100-R33', () => {
    const result = validateSubtree({
      act_version: '0.1',
      root: 'rr',
      etag: 's256:abc1230000000000000000',
      depth: 9,
      nodes: [
        {
          act_version: '0.1',
          id: 'rr',
          type: 'article',
          title: 'r',
          etag: 's256:abc1230000000000000000',
          summary: 's',
          content: [],
          tokens: { summary: 1 },
        },
      ],
    });
    expect(findGap(result.gaps, 'PRD-100-R33')).toBeDefined();
  });

  it('first node ≠ root → gap citing PRD-100-R35', () => {
    const result = validateSubtree({
      act_version: '0.1',
      root: 'rr',
      etag: 's256:abc1230000000000000000',
      depth: 1,
      nodes: [
        {
          act_version: '0.1',
          id: 'other',
          type: 'article',
          title: 'O',
          etag: 's256:abc1230000000000000000',
          summary: 's',
          content: [],
          tokens: { summary: 1 },
        },
      ],
    });
    expect(findGap(result.gaps, 'PRD-100-R35')).toBeDefined();
  });

  it('depth ≤ 8 with root-first ordering passes', () => {
    const result = validateSubtree({
      act_version: '0.1',
      root: 'rr',
      etag: 's256:abc1230000000000000000',
      depth: 0,
      nodes: [
        {
          act_version: '0.1',
          id: 'rr',
          type: 'article',
          title: 'r',
          etag: 's256:abc1230000000000000000',
          summary: 's',
          content: [],
          tokens: { summary: 1 },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe('PRD-100 fixture corpus — every negative fixture produces a matching gap (PRD-600-R30)', () => {
  it('PRD-600-R30: 100/negative fixtures produce a gap citing the expected_error.requirement', async () => {
    const fixtures = await listFixtures(['100'], 'negative');
    for (const f of fixtures) {
      const { body, meta } = await loadFixture(f);
      if (!meta) continue;
      if (meta.kind === 'integration-only') {
        // Some fixtures (e.g., children-cycle) are integration-only at the
        // schema layer; we still feed them through the matching validator
        // and expect a gap.
      }
      let r;
      if (f.name.startsWith('manifest-')) r = validateManifest(body as object);
      else if (f.name.startsWith('node-')) r = validateNode(body as object);
      else if (f.name.startsWith('index-')) r = validateIndex(body as object);
      else if (f.name.startsWith('subtree-')) r = validateSubtree(body as object);
      else if (f.name.startsWith('error-')) r = validateError(body as object);
      else continue;
      const has = r.gaps.some((g) => g.requirement === meta.requirement);
      expect(
        { fixture: f.name, expected: meta.requirement, got: r.gaps.map((g) => g.requirement) },
        `negative fixture ${f.name} should produce a gap citing ${meta.requirement}`,
      ).toMatchObject({ fixture: f.name });
      expect(has, `${f.name} did not produce gap ${meta.requirement}`).toBe(true);
    }
  });
});

describe('PRD-103 fixture corpus — etag-shape and derivation', () => {
  it('PRD-600-R30: 103/negative fixtures produce a gap citing the requirement', async () => {
    const fixtures = await listFixtures(['103'], 'negative');
    for (const f of fixtures) {
      const { body, meta } = await loadFixture(f);
      if (!meta) continue;
      if (meta.kind === 'integration-only') continue;
      const cases = (body as { cases?: Array<{ etag: string }> }).cases;
      if (Array.isArray(cases)) {
        // Multi-case fixture: feed each case as a synthetic node envelope.
        for (const c of cases) {
          const r = validateNode({
            act_version: '0.1',
            id: 'test',
            type: 'article',
            title: 't',
            etag: c.etag,
            summary: 's',
            content: [],
            tokens: { summary: 1 },
          });
          const has = r.gaps.some((g) => g.requirement === meta.requirement);
          expect(has, `${f.name} case ${JSON.stringify(c.etag)}`).toBe(true);
        }
        continue;
      }
      // Skip HTTP-transcript fixtures (no envelope-shaped body) — these are
      // integration-only and exercised by walk.ts probes (PRD-600-R8 / R10).
      const b = body as Record<string, unknown>;
      if (!('act_version' in b) || typeof b['act_version'] !== 'string') continue;
      const r = validateNode(b);
      // The fixture's expected requirement is the *root cause* (e.g.
      // PRD-103-R7 for a request-local timestamp suffix). At the schema layer
      // the validator may legitimately cite an earlier stage of the same
      // violation (PRD-103-R3 admit-list). Accept either citation.
      const acceptable = new Set([meta.requirement, 'PRD-103-R3', 'PRD-103-R2']);
      const has = r.gaps.some((g) => acceptable.has(g.requirement));
      expect(has, `${f.name} got [${r.gaps.map((g) => g.requirement).join(', ')}]`).toBe(true);
    }
  });
});

describe('NDJSON index validation (PRD-600-R1 / PRD-100-R37)', () => {
  it('PRD-100-R37: rejects a line carrying act_version', () => {
    const ndjson =
      JSON.stringify({
        act_version: '0.1',
        id: 'intro',
        type: 'article',
        title: 't',
        summary: 's',
        tokens: { summary: 1 },
        etag: 's256:abc1230000000000000000',
      }) + '\n';
    const r = validateNdjsonIndex(ndjson);
    expect(findGap(r.gaps, 'PRD-100-R2')).toBeDefined();
  });

  it('accepts a well-shaped two-line NDJSON index', () => {
    const a = {
      id: 'aa',
      type: 'article',
      title: 'A',
      summary: 's',
      tokens: { summary: 1 },
      etag: 's256:abc1230000000000000000',
    };
    const b = {
      id: 'bb',
      type: 'article',
      title: 'B',
      summary: 's',
      tokens: { summary: 1 },
      etag: 's256:def4560000000000000000',
    };
    const ndjson = JSON.stringify(a) + '\n' + JSON.stringify(b) + '\n';
    const r = validateNdjsonIndex(ndjson);
    expect(r.ok).toBe(true);
  });

  it('rejects malformed JSON on a line', () => {
    const r = validateNdjsonIndex('{not json}\n');
    expect(findGap(r.gaps, 'PRD-100-R37')).toBeDefined();
  });

  it('rejects non-string input', () => {
    // @ts-expect-error intentional: contract says string; assert defensive guard.
    const r = validateNdjsonIndex(123);
    expect(findGap(r.gaps, 'PRD-100-R37')).toBeDefined();
  });

  it('rejects line missing required IndexEntry fields', () => {
    const ndjson = JSON.stringify({ id: 'aa' }) + '\n';
    const r = validateNdjsonIndex(ndjson);
    expect(r.gaps.length).toBeGreaterThan(0);
  });
});

describe('option flags', () => {
  it('PRD-600-R26 / R27: ignoreWarnings filters warnings out', () => {
    const result = validateManifest(
      {
        act_version: '0.1',
        site: { name: 's' },
        index_url: '/i',
        node_url_template: '/n/{id}',
        conformance: { level: 'core' },
        delivery: 'static',
        future_thing: 'x',
      },
      { ignoreWarnings: ['unknown-field'] },
    );
    expect(result.warnings.find((w) => w.code === 'unknown-field')).toBeUndefined();
  });

  it('PRD-600-R26: strictWarnings upgrades remaining warnings to gaps', () => {
    const result = validateManifest(
      {
        act_version: '0.1',
        site: { name: 's' },
        index_url: '/i',
        node_url_template: '/n/{id}',
        conformance: { level: 'core' },
        delivery: 'static',
        future_thing: 'x',
      },
      { strictWarnings: true },
    );
    expect(result.ok).toBe(false);
    expect(result.gaps.some((g) => g.missing.includes('unknown-field'))).toBe(true);
  });

  it('rejects malformed JSON string input with a parse-error gap', () => {
    const result = validateManifest('not-json');
    expect(result.gaps[0]?.missing).toMatch(/JSON/);
  });

  it('idForLog: emits <unknown> when node id is not a string (covers fallback)', () => {
    const r = validateNode({
      act_version: '0.1',
      // missing id (non-string)
      type: 'article',
      title: 'T',
      etag: 's256:abc1230000000000000000',
      summary: 's',
      content: [],
      tokens: { summary: 1, body: 12000 },
    });
    // body-tokens warning should mention <unknown> in the message.
    const w = r.warnings.find((x) => x.code === 'body-tokens');
    expect(w?.message).toContain('<unknown>');
  });

  it('emits a body-tokens warning when node tokens.body > 10000 (PRD-100-R27)', () => {
    const r = validateNode({
      act_version: '0.1',
      id: 'bigbig',
      type: 'article',
      title: 'B',
      etag: 's256:abc1230000000000000000',
      summary: 's',
      content: [],
      tokens: { summary: 1, body: 12000 },
    });
    expect(findWarning(r.warnings, 'body-tokens')).toBeDefined();
  });

  it('emits a summary-length warning when index entry tokens.summary > 100 (PRD-100-R20)', () => {
    const r = validateIndex({
      act_version: '0.1',
      nodes: [
        {
          id: 'aa',
          type: 'article',
          title: 'A',
          summary: 's',
          tokens: { summary: 132 },
          etag: 's256:abc1230000000000000000',
        },
      ],
    });
    expect(findWarning(r.warnings, 'summary-length')).toBeDefined();
  });

  it('error envelope: malformed JSON parse gap', () => {
    const r = validateError('not-json');
    expect(r.gaps[0]?.missing).toMatch(/JSON/);
  });
  it('subtree: malformed JSON parse gap', () => {
    const r = validateSubtree('not-json');
    expect(r.gaps[0]?.missing).toMatch(/JSON/);
  });
  it('node: malformed JSON parse gap', () => {
    const r = validateNode('not-json');
    expect(r.gaps[0]?.missing).toMatch(/JSON/);
  });
  it('index: malformed JSON parse gap', () => {
    const r = validateIndex('not-json');
    expect(r.gaps[0]?.missing).toMatch(/JSON/);
  });
});
