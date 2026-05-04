/**
 * Conformance gate (PRD-200-R28 / PRD-208-R15): runs the programmatic
 * adapter factory over the bundled fixture corpus and validates each
 * emitted node envelope via @act-spec/validator's `validateNode`. Exits
 * non-zero on any gap.
 *
 * The corpus exercises the documented PRD-208 example surfaces:
 *  - Example 1 (minimal Core inline) — `defineProgrammaticAdapter` returns
 *    a fully PRD-100-conformant node tree.
 *  - Example 5 (recoverable transform throw) — placeholder emission carries
 *    valid envelope shape with `extraction_status: "failed"`.
 *  - Plus-tier emission with `marketing:hero` block — PRD-208-R3 +
 *    PRD-208-R8 sample probe both pass.
 *
 * Invoked by `pnpm -F @act-spec/adapter-programmatic conformance`.
 */
import { validateNode } from '@act-spec/validator';
import { runAdapter, type AdapterContext, type EmittedNode } from '@act-spec/adapter-framework';
import { defineProgrammaticAdapter, defineSimpleAdapter } from './src/index.js';

const logger = {
  debug: (m: string) => console.error('debug:', m),
  info: (m: string) => console.log('info:', m),
  warn: (m: string) => console.warn('warn:', m),
  error: (m: string) => console.error('error:', m),
};

function ctx(over: Partial<AdapterContext> = {}): AdapterContext {
  return {
    config: {},
    targetLevel: 'core',
    actVersion: '0.1',
    logger,
    signal: new AbortController().signal,
    state: {},
    ...over,
  };
}

interface Scenario {
  name: string;
  build: () => ReturnType<typeof defineProgrammaticAdapter>;
  ctxOver?: Partial<AdapterContext>;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'minimal-core-inline (PRD-208 Example 1)',
    build: () =>
      defineProgrammaticAdapter({
        name: 'fixture-source',
        enumerate: () => [
          { id: 'intro', title: 'Introduction', body: 'Hello, ACT.' },
          { id: 'guide', title: 'Guide', body: 'How to use ACT.' },
        ],
        transform: (item) =>
          ({
            act_version: '0.1',
            id: item.id,
            type: 'article',
            title: item.title,
            etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
            summary: item.body.slice(0, 60),
            content: [{ type: 'markdown', text: item.body }],
            tokens: { summary: 4 },
          }) as EmittedNode,
      }),
  },
  {
    name: 'recoverable-transform-throw (PRD-208 Example 5)',
    build: () =>
      defineProgrammaticAdapter({
        name: 'flaky-source',
        enumerate: () => [{ id: 'ok' }, { id: 'broken' }],
        transform: (item) => {
          if (item.id === 'broken') throw new Error('downstream API timeout');
          return {
            act_version: '0.1',
            id: item.id,
            type: 'article',
            title: 'OK',
            etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
            summary: 'Healthy item.',
            content: [{ type: 'markdown', text: 'body' }],
            tokens: { summary: 2 },
          } as EmittedNode;
        },
      }),
  },
  {
    name: 'strict-marketing (PRD-208-R3 + R8 probe pass)',
    build: () =>
      defineProgrammaticAdapter({
        name: 'shop',
        capabilities: { level: 'strict' },
        enumerate: () => [{ id: 'hero' }],
        transform: (item) =>
          ({
            act_version: '0.1',
            id: item.id,
            type: 'product',
            title: 'Hero product',
            etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
            summary: 'Hero product summary.',
            content: [
              { type: 'prose', format: 'markdown', text: 'Long copy.' },
              { type: 'marketing:hero', text: 'Welcome' },
            ],
            tokens: { summary: 3 },
          }) as EmittedNode,
      }),
    ctxOver: { targetLevel: 'strict' },
  },
  {
    name: 'simple-adapter (defineSimpleAdapter convenience)',
    build: () =>
      defineSimpleAdapter({
        name: 'inline',
        items: [{ id: 'one' }, { id: 'two' }],
        transform: (item) =>
          ({
            act_version: '0.1',
            id: item.id,
            type: 'article',
            title: `Item ${item.id}`,
            etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
            summary: 'tiny',
            content: [{ type: 'markdown', text: 'body' }],
            tokens: { summary: 1 },
          }) as EmittedNode,
      }),
  },
];

async function main(): Promise<void> {
  let totalNodes = 0;
  let failed = 0;
  for (const sc of SCENARIOS) {
    console.log(`\nScenario: ${sc.name}`);
    const c = ctx(sc.ctxOver);
    const adapter = sc.build();
    const result = await runAdapter(adapter, c.config, c);
    console.log(
      `  Adapter "${result.adapter}" emitted ${String(result.nodes.length)} nodes (${String(result.warnings.length)} warnings).`,
    );
    totalNodes += result.nodes.length;
    for (const node of result.nodes) {
      const probe = validateNode(node);
      if (probe.gaps.length === 0) {
        console.log(`    PASS ${node.id}`);
      } else {
        failed += 1;
        console.error(`    FAIL ${node.id}`);
        for (const g of probe.gaps) console.error(`      [${g.requirement}] ${g.missing}`);
      }
    }
  }

  if (failed > 0) {
    console.error(`\nConformance failed: ${String(failed)} node(s) had validator gaps.`);
    process.exit(1);
  }
  console.log(`\nConformance summary: ${String(totalNodes)} nodes, 0 gaps.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
