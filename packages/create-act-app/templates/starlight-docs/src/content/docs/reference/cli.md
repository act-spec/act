---
title: CLI
description: Inspect and validate the ACT artifacts emitted by the build.
summary: Inspect and validate the ACT artifacts emitted by the build.
type: reference
parent: root
related:
  - getting-started
  - reference/configuration
---

# CLI

After `pnpm build`, the ACT tree lives under `dist/`:

```
dist/
├── .well-known/
│   └── act.json          # discovery manifest
├── act/
│   ├── index.json        # one entry per node
│   ├── nodes/<id>.json   # one file per content node
│   └── subtrees/<id>.json
├── llms.txt              # back-compat /llms.txt
├── llms-full.txt         # back-compat /llms-full.txt
└── (Starlight HTML output)
```

## Inspect locally

```sh
cat dist/.well-known/act.json | jq
cat dist/act/index.json | jq '.nodes | length'
```

## Validate

This package's own `conformance.ts` script runs the
`@act-spec/validator` `walkStatic` walker against `dist/` and exits
non-zero if any gap or level mismatch is detected:

```sh
pnpm conformance
```

## Validate hosted output

Once you deploy `dist/` somewhere with a public URL, run:

```sh
pnpm dlx @act-spec/cli validate https://docs.example
```
