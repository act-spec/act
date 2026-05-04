# @act-spec/core

Shared TypeScript types for ACT (Agent Content Tree).

Two surfaces:

- **Hand-written reporter contracts** (`src/conformance-reporter.ts`) — the conformance reporter types (`Gap`, `Warning`, `AchievedLevel`, `ConformanceReport`, `ValidationResult`, `Reporter`) used by `@act-spec/validator` and downstream consumers.
- **Codegen'd envelope types** (`src/generated/`) derived from the JSON schemas in `schemas/{100,101,102,103,109}/*.schema.json`. Run `pnpm -F @act-spec/core codegen` after schema changes; the output is gitignored and rebuilt on demand.

The codegen entrypoint is `scripts/codegen.ts`. It walks `schemas/`, emits one `.ts` per `.schema.json`, and rewrites the `src/generated/index.ts` barrel.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/core": "workspace:*" } }
```

## Links

- Repository: <https://github.com/act-spec/act>
