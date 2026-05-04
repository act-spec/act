# act/go — Go reference implementation of ACT v0.2

Go reference implementation of [ACT (Agent Content Tree)](../spec/v0.2/) v0.2.

This module ships alongside the canonical TypeScript reference under
[`packages/`](../packages/). Both implementations are first-party for v0.2.

## Module layout

```
go/
├── cmd/
│   └── actree/        CLI entrypoint (stub; full CLI lands later)
├── pkg/
│   ├── core/          Wire-format Go types (manifest, index, node, …)
│   ├── validator/     JSON-Schema-backed envelope validation
│   ├── inspector/     Reserved — live HTTP probes
│   └── adapters/
│       └── hugo/      Reserved — Hugo SSG adapter
├── go.mod
└── README.md
```

## Install

```sh
# (placeholder) — module is not yet published.
go get github.com/act-spec/act/go
```

A binary build:

```sh
cd go
go build -o ./bin/actree ./cmd/actree
./bin/actree --version
```

## Schema source of truth

The validator loads schemas from the repo's top-level
[`schemas/`](../schemas/) directory. When invoked from a working tree, it
walks up from `cwd` looking for a `schemas/` sibling (mirroring the TS
validator's `findRepoRoot` behaviour). Pass an absolute path to
`validator.New(schemasDir)` to override.

## Fixture parity

`go test ./pkg/validator/...` walks every JSON fixture under
[`fixtures/`](../fixtures/) that maps to one of the three top-level envelope
shapes (manifest / index / node) and asserts that the Go validator agrees
with the fixture's declared polarity. Fixtures whose validation lives in
the cross-cutting (non-schema) surface — children-cycle detection, etag
re-derivation, HTTP-state transcripts — are listed in `integrationOnly` in
`pkg/validator/validator_test.go` with a per-entry justification.

## License

Apache-2.0. See the repo-root [`LICENSE`](../LICENSE).
