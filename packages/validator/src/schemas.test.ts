/**
 * Tests for the schema bundle loader (PRD-600-R1).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import {
  _resetCompiledSchemasForTest,
  ajvErrorToRequirement,
  compileSchemasFromRaw,
  findRepoRoot,
  getCompiledSchemas,
  loadSchemas,
  setCompiledSchemas,
  SCHEMAS_DIR,
} from './schemas.js';

describe('loadSchemas / getCompiledSchemas', () => {
  it('PRD-600-R1: compiles every required envelope shape', () => {
    const s = loadSchemas();
    expect(typeof s.manifest).toBe('function');
    expect(typeof s.index).toBe('function');
    expect(typeof s.indexEntry).toBe('function');
    expect(typeof s.node).toBe('function');
    expect(typeof s.subtree).toBe('function');
    expect(typeof s.error).toBe('function');
    expect(typeof s.etag).toBe('function');
  });

  it('caches the compiled bundle (lazy singleton)', () => {
    _resetCompiledSchemasForTest();
    const a = getCompiledSchemas();
    const b = getCompiledSchemas();
    expect(a).toBe(b);
  });

  it('findRepoRoot throws when no schemas/ ancestor exists', () => {
    expect(() => findRepoRoot('/')).toThrow(/could not locate repo root/);
  });
});

describe('compileSchemasFromRaw / setCompiledSchemas (browser-host injection path)', () => {
  /** Read every schemas/{NNN}/*.schema.json from disk for the test fixture. */
  function readAllRawSchemas(): { $id?: string; [k: string]: unknown }[] {
    const out: { $id?: string; [k: string]: unknown }[] = [];
    for (const series of readdirSync(SCHEMAS_DIR)) {
      if (!/^\d{3}$/.test(series)) continue;
      const seriesDir = path.join(SCHEMAS_DIR, series);
      for (const file of readdirSync(seriesDir).filter((f) => f.endsWith('.schema.json'))) {
        out.push(
          JSON.parse(readFileSync(path.join(seriesDir, file), 'utf8')) as {
            $id?: string;
            [k: string]: unknown;
          },
        );
      }
    }
    return out;
  }

  it('compileSchemasFromRaw produces the same shape as loadSchemas() (PRD-600-R1, browser path)', () => {
    const raw = readAllRawSchemas();
    const compiled = compileSchemasFromRaw(raw);
    expect(typeof compiled.manifest).toBe('function');
    expect(typeof compiled.index).toBe('function');
    expect(typeof compiled.indexEntry).toBe('function');
    expect(typeof compiled.node).toBe('function');
    expect(typeof compiled.subtree).toBe('function');
    expect(typeof compiled.error).toBe('function');
    expect(typeof compiled.etag).toBe('function');
  });

  it('setCompiledSchemas seeds the singleton (browser SPA startup path)', () => {
    _resetCompiledSchemasForTest();
    const raw = readAllRawSchemas();
    const compiled = compileSchemasFromRaw(raw);
    setCompiledSchemas(compiled);
    // getCompiledSchemas now returns the seeded bundle without touching fs.
    expect(getCompiledSchemas()).toBe(compiled);
    _resetCompiledSchemasForTest();
  });

  it('compileSchemasFromRaw throws when index schema is absent from the bundle', () => {
    const raw = readAllRawSchemas().filter(
      (s) => s.$id !== 'https://act-spec.org/schemas/0.1/index.schema.json',
    );
    expect(() => compileSchemasFromRaw(raw)).toThrow(/index schema/);
  });
});

describe('ajvErrorToRequirement: Ajv error → PRD-NNN-Rn citation (PRD-600-R2)', () => {
  it('routes pattern violation on /act_version → PRD-100-R1', () => {
    expect(
      ajvErrorToRequirement('manifest', {
        keyword: 'pattern',
        instancePath: '/act_version',
        schemaPath: '',
        params: {},
        message: 'pattern',
      }),
    ).toBe('PRD-100-R1');
  });

  it('routes enum violation on /conformance/level → PRD-107-R2', () => {
    expect(
      ajvErrorToRequirement('manifest', {
        keyword: 'enum',
        instancePath: '/conformance/level',
        schemaPath: '',
        params: {},
        message: 'enum',
      }),
    ).toBe('PRD-107-R2');
  });

  it('routes enum violation on /delivery → PRD-107-R3', () => {
    expect(
      ajvErrorToRequirement('manifest', {
        keyword: 'enum',
        instancePath: '/delivery',
        schemaPath: '',
        params: {},
        message: 'enum',
      }),
    ).toBe('PRD-107-R3');
  });

  it('routes enum violation on /error/code → PRD-100-R41', () => {
    expect(
      ajvErrorToRequirement('error', {
        keyword: 'enum',
        instancePath: '/error/code',
        schemaPath: '',
        params: {},
        message: 'enum',
      }),
    ).toBe('PRD-100-R41');
  });

  it('routes pattern violation on /id → PRD-100-R10', () => {
    expect(
      ajvErrorToRequirement('node', {
        keyword: 'pattern',
        instancePath: '/id',
        schemaPath: '',
        params: {},
        message: 'pattern',
      }),
    ).toBe('PRD-100-R10');
  });

  it('routes pattern violation on /root → PRD-100-R10', () => {
    expect(
      ajvErrorToRequirement('subtree', {
        keyword: 'pattern',
        instancePath: '/root',
        schemaPath: '',
        params: {},
        message: 'pattern',
      }),
    ).toBe('PRD-100-R10');
  });

  it('routes pattern violation on /node_url_template → PRD-100-R5', () => {
    expect(
      ajvErrorToRequirement('manifest', {
        keyword: 'pattern',
        instancePath: '/node_url_template',
        schemaPath: '',
        params: {},
        message: 'pattern',
      }),
    ).toBe('PRD-100-R5');
  });

  it('routes required-field violation per envelope', () => {
    const cases: Array<['manifest' | 'index' | 'indexEntry' | 'node' | 'subtree' | 'error', string]> = [
      ['manifest', 'PRD-100-R4'],
      ['index', 'PRD-100-R17'],
      ['indexEntry', 'PRD-100-R17'],
      ['node', 'PRD-100-R21'],
      ['subtree', 'PRD-100-R32'],
      ['error', 'PRD-100-R41'],
    ];
    for (const [env, expected] of cases) {
      expect(
        ajvErrorToRequirement(env, {
          keyword: 'required',
          instancePath: '',
          schemaPath: '',
          params: { missingProperty: 'x' },
          message: 'required',
        }),
      ).toBe(expected);
    }
  });

  it('routes additionalProperties violation on error envelope → PRD-100-R41', () => {
    expect(
      ajvErrorToRequirement('error', {
        keyword: 'additionalProperties',
        instancePath: '',
        schemaPath: '',
        params: {},
        message: 'extra',
      }),
    ).toBe('PRD-100-R41');
  });

  it('routes additionalProperties violation on manifest envelope → PRD-100-R6', () => {
    expect(
      ajvErrorToRequirement('manifest', {
        keyword: 'additionalProperties',
        instancePath: '/conformance',
        schemaPath: '',
        params: {},
        message: 'extra',
      }),
    ).toBe('PRD-100-R6');
  });

  it('routes type violation on /capabilities (legacy array form) → PRD-100-R6', () => {
    expect(
      ajvErrorToRequirement('manifest', {
        keyword: 'type',
        instancePath: '/capabilities',
        schemaPath: '',
        params: {},
        message: 'type',
      }),
    ).toBe('PRD-100-R6');
  });

  it('routes maximum violation on /depth → PRD-100-R33', () => {
    expect(
      ajvErrorToRequirement('subtree', {
        keyword: 'maximum',
        instancePath: '/depth',
        schemaPath: '',
        params: {},
        message: 'max',
      }),
    ).toBe('PRD-100-R33');
  });

  it('falls through to envelope-class default for unrecognized cases', () => {
    expect(
      ajvErrorToRequirement('manifest', {
        keyword: 'unknown',
        instancePath: '/whatever',
        schemaPath: '',
        params: {},
        message: 'x',
      }),
    ).toBe('PRD-100-R3');
    expect(
      ajvErrorToRequirement('index', {
        keyword: 'unknown',
        instancePath: '/whatever',
        schemaPath: '',
        params: {},
        message: 'x',
      }),
    ).toBe('PRD-100-R16');
    expect(
      ajvErrorToRequirement('indexEntry', {
        keyword: 'unknown',
        instancePath: '/whatever',
        schemaPath: '',
        params: {},
        message: 'x',
      }),
    ).toBe('PRD-100-R16');
    expect(
      ajvErrorToRequirement('node', {
        keyword: 'unknown',
        instancePath: '/whatever',
        schemaPath: '',
        params: {},
        message: 'x',
      }),
    ).toBe('PRD-100-R21');
    expect(
      ajvErrorToRequirement('subtree', {
        keyword: 'unknown',
        instancePath: '/whatever',
        schemaPath: '',
        params: {},
        message: 'x',
      }),
    ).toBe('PRD-100-R32');
    expect(
      ajvErrorToRequirement('error', {
        keyword: 'unknown',
        instancePath: '/whatever',
        schemaPath: '',
        params: {},
        message: 'x',
      }),
    ).toBe('PRD-100-R41');
  });
});
