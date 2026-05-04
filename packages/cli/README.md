# @act-spec/cli

Standalone CLI for ACT (Agent Content Tree). Framework-free orchestration
of the ACT generator pipeline (`@act-spec/generator-core`): loads
`act.config.{ts,mts,mjs,cjs,js,json}`, instantiates adapters, runs the
pipeline, and writes the static file set. The binary is `actree` (renamed
from `act` in v0.2 to avoid colliding with nektos/act on PATH; the package
name `@act-spec/cli` is unchanged).

## Status

ACT v0.1 internal hand-test candidate. Public release lands at v0.2.

## Install

Unpublished in v0.1. Consume via the workspace:

```jsonc
// package.json
{ "devDependencies": { "@act-spec/cli": "workspace:*" } }
```

For out-of-tree hand-test, run `pnpm pack` inside `packages/cli` and
install the resulting tarball locally; the `actree` binary is exposed via
the package's `bin` field.

## Usage

`act.config.ts`:

```ts
import { defineConfig } from '@act-spec/cli';
import { markdown } from '@act-spec/adapter-markdown';

export default defineConfig({
  output: { dir: 'public/act' },
  manifest: { site: { name: 'Tinybox' } },
  conformanceTarget: 'standard',
  adapters: [markdown({ rootDir: './content' })],
});
```

CLI:

```bash
actree build                # one-shot build
actree build --watch        # rebuild on adapter source changes
actree init tinybox ./site  # scaffold a starter project
actree flatten <url>        # walk an ACT site and dump an llms-full.txt-style render
```

### `actree flatten <url>`

Discover the manifest at `<url>/.well-known/act.json`, walk the index, fetch
every node envelope, and concatenate them as a single llms-full.txt-style
markdown document on stdout. Useful for: feeding an entire ACT site to an
LLM, debugging a deployed site end-to-end, or smoke-testing that a remote
producer's manifest + index + nodes line up.

```bash
# Print to stdout
actree flatten https://docs.example.com

# Pick a non-default locale
actree flatten https://docs.example.com --locale fr

# Cap the output size and write to a file
actree flatten https://docs.example.com --max-bytes 200000 --out dump.md
```

Example output (truncated):

```text
# Example Docs

> A sample site

_locale: en_

---

---
id: intro
type: doc
title: "Introduction"
---

# Introduction

A short summary of the intro page.

Welcome to the Example Docs.

---

...
```

Failure modes (exit code `1`): unreachable manifest, non-JSON manifest,
unsupported `act_version`, missing `index_url` / `node_url_template`. Usage
errors (missing `<url>`, malformed `--max-bytes`) exit `2`.

Programmatic:

```ts
import { runBuild, watchBuild, loadConfig } from '@act-spec/cli';

const config = await loadConfig(process.cwd());
const report = await runBuild(config, { logger: 'json' });
```

## Conformance / what's tested

Every public API has a citing test in the package's test suite, including
config-file resolution order (`CONFIG_SEARCH_ORDER`), profile shorthand
application, output-dir conflict detection, host-framework field detection
(warns when `act.config` is used in a project that should use the
framework's plugin instead), the duration-flag parser, the watch re-entry
guard, and the build-timeout error path. The conformance gate runs
`@act-spec/validator` against the emitted file set.

```bash
pnpm -F @act-spec/cli conformance
```

## Configuration

`GeneratorConfig` is re-exported from `@act-spec/generator-core` so
developers import everything they need from `@act-spec/cli` alone. CLI
flags layer on top:

| Flag | Maps to | Notes |
| --- | --- | --- |
| `--config <path>` | explicit config path | overrides `CONFIG_SEARCH_ORDER`. |
| `--watch` | `watchBuild` | requires a TTY-friendly logger. |
| `--profile <name>` | `applyProfileOverride` | profile shorthand. |
| `--timeout <duration>` | `runBuild({ timeout })` | parsed by `parseDuration`. |
| `--logger <mode>` | `selectLoggerMode` | `'tty' \| 'plain' \| 'json'`. |

## Compatibility

No host-framework peer dependency. For framework-aware integrations,
prefer the dedicated generator (`@act-spec/plugin-astro`, `@act-spec/plugin-eleventy`,
`@act-spec/plugin-nuxt`, etc.).

## Links

- Generator core: [`@act-spec/generator-core`](../generator-core)
- Repository: <https://github.com/act-spec/act>
