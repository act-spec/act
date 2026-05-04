# @act-spec/validator

Conformance validator for ACT (Agent Content Tree).

When implemented, this package ships:

- `validateManifest`, `validateNode`, `validateIndex`, `validateNdjsonIndex`, `validateSubtree`, `validateError`, `validateSite` (TypeScript library).
- `act-validate` CLI.
- A static SPA at `/validator/` on the ACT spec's GitHub Pages site.

The reporter shape (`Gap`, `Warning`, `AchievedLevel`, `ConformanceReport`) lives in `@act-spec/core`.

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "dependencies": { "@act-spec/validator": "workspace:*" } }
```

## Usage

```ts
import { validateSite, validateManifest, validateNode } from '@act-spec/validator';

const report = await validateSite('https://example.com/');
if (report.gaps.length === 0) {
  console.log(`Achieved level: ${report.achievedLevel}`);
}
```

CLI:

```bash
act-validate https://example.com/
```

Browser UI (boots the validator SPA on http://localhost:5174/validator/, paste any
URL — including `http://localhost:<port>` for a locally-running ACT site):

```bash
pnpm -F @act-spec/validator start
```

## Links

- Reporter types: [`@act-spec/core`](../core)
- Repository: <https://github.com/act-spec/act>
