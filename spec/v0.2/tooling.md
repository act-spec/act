---
title: Tooling
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Tooling

> ACT ships a small set of normative tools alongside the spec: a
> validator (which is the operational definition of the conformance
> levels), an inspector for human-driven walks of an ACT tree, and an
> MCP bridge that exposes any ACT site to MCP-capable agents. This
> document defines the command-line surface of each tool, the validator
> report format, the MCP server's tool taxonomy, and the rules
> well-behaved agents and crawlers MUST follow when consuming an ACT
> producer.

## Tooling philosophy

The validator is the operational definition of conformance. Where the
prose in [wire-format/conformance.md](./wire-format/conformance.md)
and the validator's behavior diverge, the prose is authoritative and
the validator is bug-for-fix; in practice the two agree because every
fixture under [`fixtures/`](../../fixtures/) anchors both sides.

The inspector and the MCP bridge are layered consumers of the same
parsing surface the validator uses. They do not invent their own
schema validation or discovery walks; they import the validator's
parser and report shape so a producer that satisfies the validator
will also be cleanly walkable by the inspector and bridgeable by the
MCP server.

All three tools are TypeScript packages. The validator and inspector
ship as both libraries (`@act-spec/validator`, `@act-spec/inspector`)
and command-line binaries (`act-validate`, `act-inspect`). The MCP
bridge ships as `@act-spec/mcp-server` and is also operated as a
hosted instance for clients that prefer not to self-host.

## Validator

The validator probes a producer end-to-end and reports whether the
producer satisfies the conformance level it declares. It is the
operational definition of the level contract: every fixture in
[`fixtures/`](../../fixtures/) is exercised against the validator,
and every conformance claim a producer makes is testable by running
the validator against the producer.

### CLI

```
act-validate [--url <url> | --file <path>] [options]
```

The CLI MUST accept the following flags:

- `--url <url>` — target a live deployment (triggers discovery walk).
- `--file <path>` — target a single envelope file on disk.
- `--conformance` — emit the full conformance report (only with `--url`).
- `--level <core|standard|strict>` — assert a minimum level; non-zero
  exit if the achieved level is below.
- `--profile <static|runtime>` — assert a delivery profile; non-zero
  exit on mismatch.
- `--probe-auth` — when probing a runtime origin requiring auth,
  exercise the 401 + `WWW-Authenticate` contract. Without this flag
  the validator skips auth-protected endpoints and warns.
- `--ignore-warning <code>` (repeatable) — suppress a specific
  warning code.
- `--strict-warnings` — exit non-zero on any warning (default:
  warnings are non-blocking).
- `--max-requests <N>` — total HTTP request budget per invocation
  (default 64).
- `--rate-limit <N>` — per-origin requests per second (default 1).
- `--sample <N|all>` — node-sample size for the site walk (default
  16).
- `--json` — emit the report as JSON to stdout (machine-readable).
- `--verbose` — emit human-readable debug to stderr.
- `--version` — print bundled `act_version` and validator version.
- `--help` — print usage.

`--file` and `--url` are mutually exclusive. The validator's `--help`
output MUST document the CORS limitation and the search-body
limitation (described below).

### Exit codes

- **0** — pass; no errors and (in lenient mode) no blocking
  warnings.
- **1** — validation errors; the `gaps` array is non-empty.
- **2** — invocation error (bad argv, network unreachable, file
  unreadable).
- **3** — `--level` or `--profile` assertion failed; achieved level
  or profile does not match.
- **4** — `act_version` MAJOR mismatch (the producer reports a
  spec MAJOR the validator does not implement).

### Library API

The validator MUST also be consumable as a TypeScript library
(`@act-spec/validator`). The public surface includes per-envelope
checks and a full discovery walk:

```ts
export function validateManifest(input: string | object, opts?: ValidateOptions): ValidationResult;
export function validateNode(input: string | object, opts?: ValidateOptions): ValidationResult;
export function validateIndex(input: string | object, opts?: ValidateOptions): ValidationResult;
export function validateNdjsonIndex(input: string, opts?: ValidateOptions): ValidationResult;
export function validateSubtree(input: string | object, opts?: ValidateOptions): ValidationResult;
export function validateError(input: string | object, opts?: ValidateOptions): ValidationResult;
export function validateSite(url: string, opts?: ValidateSiteOptions): Promise<ConformanceReport>;
```

`ValidationResult` is per-envelope (`{ ok, errors, warnings }`);
`ConformanceReport` is the full report shape defined in
[wire-format/conformance.md](./wire-format/conformance.md). Each
function accepts a custom `fetch` adapter for credential injection
when probing auth-gated runtimes.

### What the validator probes

The validator validates every JSON envelope (manifest, index, NDJSON
index lines, node, subtree, error) against the JSON Schemas under
[`schemas/`](../../schemas/) and checks cross-cutting rules that
schemas alone cannot express:

- Cycle detection in the `children` graph (cycles MUST cause a hard
  error per [node.md](./wire-format/node.md)).
- Runtime ETag determinism (two consecutive identical requests with
  identical credentials MUST produce byte-identical ETags).
- HTTP `ETag` header byte-equality with the envelope's `etag` field
  (modulo RFC 9110 §8.8.3 double-quoting; no `W/` prefix).
- `mounts` no-recursion and longest-prefix matching.
- Discovery-context-vs-`delivery` consistency (a manifest reached via
  the well-known path MUST declare `delivery: "static"`; a manifest
  reached via the runtime hand-off `Link` header MUST declare
  `delivery: "runtime"`).
- Existence non-leak on runtime producers (probing a private resource
  unauthenticated MUST return the same byte string a missing resource
  returns).

### Reporter shape

The validator emits a `ConformanceReport` with the seven required
fields: `act_version`, `url`, `declared`, `achieved`, `gaps`,
`warnings`, `passed_at`. The shape is normative — see
[wire-format/conformance.md](./wire-format/conformance.md). The
validator MAY add envelope-level extensions (e.g., `validator_version`,
`walk_summary`); it MUST NOT remove or rename a required field.

The `achieved` field is populated by **probing**, not by trusting the
manifest's declaration. A producer claiming Strict but failing a
Standard requirement reports `achieved.level: "core"` (or `null` if
Core fails); the gap is enumerated under `gaps[]` with the source
requirement cited.

### Limitations

**CORS.** The hosted validator SPA cannot fetch from origins that
block CORS preflight or deny `Access-Control-Allow-Origin: *`. When a
fetch fails for CORS reasons, the SPA surfaces the failure as a
warning coded `cors-blocked` and offers a direct-paste fallback —
the user pastes the manifest JSON, node JSON, or index JSON into a
textarea and the SPA validates the pasted content as if fetched. The
CLI is unaffected by CORS.

**Search response body.** v0.2 does not validate the search response
**body** against any normative schema. It validates only that the
manifest's `search_url_template` is present and contains `{query}`,
and that the endpoint returns HTTP 200 with a JSON-parseable body.
Every report whose target advertises `search_url_template` carries a
warning coded `search-body-deferred`. The body envelope is reserved
for a future MINOR.

### Hosted SPA

A hosted browser instance of the validator is served at the path
`/validator/` on the spec project's site. The SPA is fully
client-side: no backend, no telemetry, only the user-driven probe to
the target manifest URL. The SPA footer displays the bundled
`act_version`, the validator package version, and the build
timestamp.

## Inspector / CLI walk

The inspector is a human-oriented tool for exploring an ACT tree:
walking it, summarizing its shape, fetching individual nodes, diffing
two trees, and budgeting "which subtree fits in N tokens." It is
**not** a validator; it does not produce a conformance report. When
the inspector observes an obvious gap (e.g., a manifest declares
`subtree_url_template` but a sampled subtree URL returns 404) it
emits a `findings` entry pointing at the inconsistency and recommends
running `act-validate` for a full verdict.

The inspector imports its envelope parsers and discovery walk module
from `@act-spec/validator` rather than re-implementing them. Parser
parity with the conformance gate is therefore guaranteed.

### CLI

The inspector binary is `act-inspect`. It accepts the following
subcommands:

```
act-inspect inspect <url>             # walk + manifest summary + sample N nodes
act-inspect walk <url>                # walk every node; aggregate stats
act-inspect node <url> <id>           # fetch one node
act-inspect subtree <url> <id> [--depth N]   # fetch subtree (Standard producer)
act-inspect diff <url-a> <url-b>      # diff two trees by id
act-inspect budget <url> --max-tokens N      # what subtree fits in N tokens
```

Subcommands that require a higher-level producer (`subtree` requires
Standard; `walk --use-ndjson` requires Strict) MUST emit a clear
error citing the manifest's declared level when the requirement is
not satisfied.

Common flags accepted by every networked subcommand:

- `--header <"Name: value">` (repeatable) — inject HTTP headers
  (e.g., `--header 'Authorization: Bearer ...'`); the inspector MUST
  NOT log the values.
- `--max-requests <N>` — total HTTP request budget (default 256;
  `inspect` defaults to 32).
- `--rate-limit <N>` — per-origin requests per second (default 1).
- `--no-cache` — disable `If-None-Match` emission.
- `--no-follow-cross-origin` — suppress cross-origin mount fetches.
- `--json` / `--tsv` — machine-readable output (mutually exclusive).
- `--verbose` — debug output to stderr.

The inspector MUST emit `If-None-Match` on every fetch when a prior
fetch in the same invocation returned 200 with an `ETag`, and MUST
report 304 cache hits in human output as `(304 cached)` and in JSON
output as `"cache_hit": true` per fetch entry.

### `act-inspect flatten`

The inspector also exposes a `flatten <url>` subcommand that walks
the tree and renders it as a single `llms-full.txt`-formatted
document on stdout (or to a file via `--out`). This is the canonical
way to feed an ACT tree to a chat model with no MCP support:

```
act-inspect flatten https://docs.example.com --max-bytes 200000 --out site.txt
```

The output format follows the de-facto `llms-full.txt` convention:
each leaf node is rendered as markdown with frontmatter, concatenated
in walk order. A `--max-bytes` flag truncates the output and emits a
trailing notice naming the elision.

### `act-inspect diff`

The diff classifies each node `id` present in either tree into
exactly one of: `added`, `removed`, `etag_unchanged`, `etag_changed`,
`structural_change`. The diff is by `id`, not by structural
similarity (no fuzzy matching). With `--include-content` the
inspector fetches both nodes' full envelopes for `etag_changed`
entries and computes a per-field changeset; `--ignore-fields
<list>` suppresses fields known to drift (`updated_at`, etc.).

Default exit posture: `act-inspect diff` exits 1 on any difference,
making it suitable as a CI gate. `--no-fail-on-diff` flips the exit
to 0 on diff.

### `act-inspect budget`

The budget computation answers "which subset of nodes fits in N
tokens?" using the producer's declared `tokens.summary` and
`tokens.body` as authoritative. Two strategies:

- **`breadth-first` (default).** Walk children layer by layer from
  the start node; include each node (full body) until adding the next
  would exceed `N`. This matches the canonical agent pattern of
  "start at root, descend on demand."
- **`deepest-first`.** Walk to leaves first, ascending only when all
  descendants up to the cutoff are included.

The output names the strategy, the budget, an ordered list of
`(id, tokens, cumulative_tokens)`, and a summary of nodes-included
vs nodes-excluded. The inspector documents that `tokens.*` values
are producer-declared and not validated; a producer that
mis-declares its tokens will mislead the budget.

### Library API

Every CLI subcommand maps to a corresponding TypeScript export in
`@act-spec/inspector`:

```ts
export function inspect(url: string, opts?: InspectOptions): Promise<InspectResult>;
export function walk(url: string, opts?: WalkOptions): Promise<WalkResult>;
export function diff(urlA: string, urlB: string, opts?: DiffOptions): Promise<DiffResult>;
export function node(url: string, id: string, opts?: NodeOptions): Promise<NodeResult>;
export function subtree(url: string, id: string, opts?: SubtreeOptions): Promise<SubtreeResult>;
export function budget(url: string, maxTokens: number, opts?: BudgetOptions): Promise<BudgetResult>;
```

Each accepts a `fetch?: typeof globalThis.fetch` for credential
injection (mirroring the validator). The functions MUST NOT log or
mutate global state; results are returned by value.

## MCP server

`@act-spec/mcp-server` exposes any ACT site as an MCP server. It is
the bridge between ACT (the data shape and discovery contract) and
MCP (the agent transport). Operators run the bridge in one of three
shapes:

- **As a local stdio server** invoked via
  `npx @act-spec/mcp-server <url>`, suitable for Claude Desktop /
  Cursor / Continue MCP configurations.
- **As a hosted multi-tenant instance** at `mcp.act-spec.org`,
  rate-limited and serving any public ACT site. Clients paste a
  short JSON snippet into their MCP config and gain immediate access
  to any ACT-emitting site without running anything locally.
- **Self-hosted** by an operator who wants per-tenant auth, custom
  identity bridging, or a private deployment. The same package
  serves both modes; the operator provides an `IdentityBridge`
  adapter when serving auth-gated content.

### Tools

The bridge advertises the following MCP tools. Each operates against
the ACT URL the client supplies (or the bridge's pinned URL when
self-hosted against a single deployment):

| Tool | Arguments | Returns |
|---|---|---|
| `act_load_site` | `{ url: string }` | The producer's manifest envelope. |
| `act_walk_subtree` | `{ url: string, node_id: string, depth?: number }` | A subtree envelope rooted at `node_id`, depth-bounded. |
| `act_get_node` | `{ url: string, node_id: string }` | A single node envelope. |
| `act_search` | `{ url: string, query: string }` | Search results from the producer's search endpoint when advertised; otherwise a documented `search_unavailable` outcome. |

The bridge MUST validate the producer's manifest before serving any
tool call. Cache TTLs default to 60 seconds for the manifest and 300
seconds for nodes; operators MAY override.

### URI scheme

ACT nodes mapped to MCP resources use the URI scheme `act://`. Two
canonical forms apply:

- **Single-mount deployments**: `act://<host>/<percent-encoded-id>`.
- **Multi-mount deployments**: `act://<host>/<prefix-segments>/<percent-encoded-id>`,
  where the prefix segments come from the parent manifest's `mounts[].prefix`.

In both forms the `<host>` is the producer's authority (typically
the deployment's primary hostname) and IDs (and prefix segments) are
encoded with per-segment percent-encoding so `/` is preserved as a
segment separator. The manifest itself is exposed at
`act://<host>/manifest`.

### Capability mapping

The bridge advertises MCP capabilities derived from the ACT
manifest's `capabilities` and `delivery`:

| ACT capability or field | MCP capability |
|---|---|
| `delivery: "runtime"` | `resources: { listChanged: true }` |
| `capabilities.subtree: true` | per-subtree list-resource |
| `capabilities.search.template_advertised: true` | `act_search` tool |

The bridge MUST NOT advertise an MCP capability whose underlying ACT
capability is not present.

### Identity propagation

Self-hosted bridges serving auth-gated content MUST be configured
with an `IdentityBridge` adapter that translates MCP's auth context
into the underlying ACT runtime's identity. The bridge MUST preserve
the existence non-leak rule: an MCP request for a resource the
identity cannot see MUST return the same MCP error envelope that a
genuinely missing resource returns.

The hosted instance at `mcp.act-spec.org` does not perform identity
bridging; it serves only public ACT sites. Operators with auth-gated
deployments MUST self-host.

### Error mapping

The bridge maps the runtime SDK's `Outcome` discriminator to MCP
errors:

| ACT outcome | MCP error |
|---|---|
| `ok` | success response with envelope body |
| `not_found` | `RESOURCE_NOT_FOUND` |
| `auth_required` | `AUTHENTICATION_REQUIRED` |
| `validation` | `INVALID_REQUEST` (with `details` propagated) |
| `internal` | `INTERNAL_ERROR` (no internals leaked) |

The bridge MUST NOT add MCP-side error fields that distinguish
"not found" from "forbidden"; preserving the existence non-leak from
[wire-format/security.md](./wire-format/security.md) is normative.

### MCP version pinning

The bridge commits to MCP 1.0 minimum with a documented forward-compat
shim. Unknown optional MCP fields are tolerated; an unknown REQUIRED
field MUST be rejected with the documented `UNKNOWN_REQUIRED_FIELD`
error and the field name surfaced. Each MCP MINOR release triggers a
re-review of the shim.

## Crawler and agent behavior

ACT-aware agents and crawlers MUST follow a small set of rules when
consuming an ACT producer. The rules are normative for any agent
claiming to be ACT-aware; producers can rely on conformant agent
behavior when sizing rate limits and caching infrastructure.

### Identification

Agents MUST identify themselves with a `User-Agent` header beginning
with the canonical token `ACT-Agent/{version}` (where `{version}` is
the agent software's own version), followed by a parenthesized
contact (URL or email) and any product-specific suffix:

```
User-Agent: ACT-Agent/1.4.2 (+https://example.com/agents/acme-bot; contact=ops@example.com) AcmeBot/1.0
```

Agents MUST NOT spoof a browser User-Agent, MUST NOT include
sensitive infrastructure identifiers in the value, and SHOULD send
the `From` header with the same contact email when an abuse channel
is needed.

### Robots.txt

ACT-aware agents MUST honor the producer's `robots.txt` (RFC 9309)
before fetching any ACT resource. A `Disallow` for `/.well-known/act.json`
matched against `User-agent: ACT-Agent` (or `*`) MUST suppress the
manifest fetch and every subsequent ACT fetch on that origin. If
`robots.txt` is unreachable, the agent SHOULD treat the origin as
disallowed until it is reachable.

For runtime producers, robots.txt discipline applies to the
discovery probe (the unauthenticated robots.txt fetch and the
unauthenticated probe of the well-known path). Once authenticated,
the producer's auth scheme is the access control.

### Rate limits

Agents MUST read the manifest's `policy.rate_limit_per_minute` field
and limit their outgoing rate to the advertised value, averaged over
any rolling 60-second window. When the field is omitted the agent
MUST default to **60 requests per minute** per origin. On 429
responses with `Retry-After` the agent MUST stop until the indicated
duration elapses; on 429 without `Retry-After` the agent SHOULD wait
at least 60 seconds.

Agents SHOULD apply a per-origin concurrency cap of 4 in-flight
requests by default and SHOULD scale outgoing rate down (never up) on
observed degradation: persistent 5xx, persistent 429, or median
latency growth above 2× baseline.

### Caching

ACT-aware agents MUST issue conditional requests using
`If-None-Match` against any ACT resource they have previously fetched
and whose ETag they have retained. Agents MUST NOT use
`If-Modified-Since` for ACT resources; ACT uses strong validators
only. On 304 the agent MUST treat its cached copy as fresh and
re-evaluate its TTL per RFC 9111.

Agents MUST honor `Cache-Control` directives (`no-store`, `no-cache`,
`private`, `max-age`, `must-revalidate`) per RFC 9111 §5.2.

### Error handling

- **5xx** — back off and retry with exponential delay and jitter
  (recommended schedule: initial 1s, multiplier 2, jitter ±25%, cap
  300s, give up after 5 attempts).
- **401** — agent MUST NOT retry without changing credentials. The
  `WWW-Authenticate` challenge MUST be surfaced to the agent's auth
  subsystem; after credential refresh, agents MAY retry **once**.
- **403** — agent MUST NOT retry. 403 is an authoritative denial.
- **404** — treat the resource as absent; do not retry the same URL
  in a short interval. A scheduled re-discovery MAY occur per the
  agent's normal cadence.
- **410** — treat the resource as **permanently absent** and SHOULD
  remove it from any persisted index. Agents MUST NOT retry a 410'd
  URL.

## Examples

### Validator JSON report (Standard static site, passing)

```
$ act-validate --url https://docs.example.com --conformance --json
```

```json
{
  "act_version": "0.2",
  "url": "https://docs.example.com/.well-known/act.json",
  "declared": { "level": "standard", "delivery": "static" },
  "achieved": { "level": "standard", "delivery": "static" },
  "gaps": [],
  "warnings": [
    {
      "level": "standard",
      "code": "summary-length",
      "message": "intro/getting-started summary is 67 tokens (SHOULD be ≤ 50)."
    }
  ],
  "passed_at": "2026-05-03T12:00:00Z"
}
```

### Inspector tree summary

```
$ act-inspect inspect https://docs.example.com
ACT site: docs.example.com
  Declared: standard / static
  Generated: 2026-05-03T11:42:18Z by @act-spec/plugin-astro/0.2.0
  Endpoints:
    manifest:   /.well-known/act.json
    index:      /act/index.json
    node:       /act/n/{id}.json
    subtree:    /act/sub/{id}.json   (advertised)
  Stats from manifest: 247 nodes
  Sampled 16 of 247 nodes:
    types: article (9), tutorial (4), reference (3)
    fanout: min=0 max=12 mean=3.4 median=2
    body tokens: min=120 max=4810 mean=1280

  Findings (informational):
    - none
```

### MCP tool call (act_load_site)

A Claude Desktop client invokes `act_load_site` against
`mcp.act-spec.org`:

```json
{
  "method": "tools/call",
  "params": {
    "name": "act_load_site",
    "arguments": { "url": "https://docs.example.com" }
  }
}
```

The bridge fetches the manifest, validates it against the schema,
and returns the envelope as the tool's result. Subsequent
`act_walk_subtree` and `act_get_node` calls reuse the cached manifest.

### Inspector diff against last build

```
$ act-inspect diff https://docs.example.com https://docs.example.com.staging
node                          status
intro                          etag_unchanged
intro/getting-started          etag_changed   (body tokens +120)
intro/auth                     added
intro/legacy-flow              removed
api/reference                  etag_unchanged
api/reference/users            structural_change   (children order)

Summary: 2 added, 1 removed, 1 etag_changed, 1 structural_change.
```

Exit code 1 (changes present) — suitable for a CI gate that fails a
PR when the rendered ACT tree drifts from the production baseline.

## Conformance

The tools themselves do not declare a conformance level — they probe
producers and consume ACT trees, they don't emit them. The validator
is the operational reference: a producer's level claim is verifiable
exactly when the validator agrees.

| Tool | Status |
|---|---|
| `act-validate` (CLI) and `@act-spec/validator` (library) | Required reference; the wire format's level definitions are operational only with the validator. |
| `act-inspect` (CLI) and `@act-spec/inspector` (library) | Recommended reference; not required for level conformance. |
| `@act-spec/mcp-server` (npm + hosted at `mcp.act-spec.org`) | Recommended reference; not required for level conformance. |
| Crawler / agent behavior rules | Normative for any tool claiming to be ACT-aware. |

A producer MAY be conformant without ever invoking these tools; the
validator simply tells the producer **whether** it is conformant.
Other tooling that consumes ACT (a search aggregator, a custom MCP
bridge, a dashboard) is welcome and MUST follow the agent-behavior
rules above when fetching from producers.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |
