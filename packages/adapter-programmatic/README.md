# @act-spec/adapter-programmatic

Programmatic adapter for ACT (Agent Content Tree) — the escape hatch for
content sources without a dedicated ACT adapter. A factory
(`defineProgrammaticAdapter`) wraps user-supplied `enumerate` and
`transform` functions into a fully conformant `Adapter`. The factory
adds:

- Pre-emit validation against `schemas/100/node.schema.json` and the applicable
  `schemas/102/block-*.schema.json` per content block.
- `Object.freeze` on `ctx.config` to prevent accidental mutation.
- Source attribution: `metadata.source.adapter` defaults to `spec.name`.
- Capability sampling probe: every Nth emission is checked against the declared
  level.
- Strict / recoverable failure policies for user-thrown errors.
- Idempotent `dispose` wrapper.
- Tolerates `Iterable | AsyncIterable | Array` returns from `enumerate`.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/adapter-programmatic": "workspace:*" } }
```

## Quickstart

```ts
import { defineProgrammaticAdapter } from '@act-spec/adapter-programmatic';

export default defineProgrammaticAdapter({
  name: 'fixture-source',
  enumerate: () => [
    { id: 'intro', title: 'Introduction', body: 'Hello, ACT.' },
  ],
  transform: (item) => ({
    act_version: '0.1',
    id: item.id,
    type: 'article',
    title: item.title,
    etag: 's256:AAAAAAAAAAAAAAAAAAAAAA',
    summary: item.body.slice(0, 60),
    content: [{ type: 'markdown', text: item.body }],
    tokens: { summary: 4 },
  }),
});
```

## Convenience: `defineSimpleAdapter`

For the static-array case:

```ts
import { defineSimpleAdapter } from '@act-spec/adapter-programmatic';

export default defineSimpleAdapter({
  name: 'inline',
  items: [{ id: 'a', title: 'A' }],
  transform: (item) => ({ /* … */ }),
});
```

## Conformance / what's tested

Every public API has a citing test in `src/programmatic.test.ts`. The
conformance gate runs `@act-spec/validator` against the bundled fixture
corpus under `test-fixtures/` and exits non-zero on any gap.

```bash
pnpm -F @act-spec/adapter-programmatic conformance
```

## Links

- Adapter framework: [`@act-spec/adapter-framework`](../adapter-framework)
- Repository: <https://github.com/act-spec/act>
