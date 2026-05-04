---
title: Spec governance
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# Spec governance

> This document covers the **spec-specific** change process: how a
> normative change to ACT is proposed, reviewed, accepted, and
> released; how spec versions evolve; how new fields, capabilities,
> and node types are named; and how migrations are sequenced when a
> change has consumer impact. For project-level governance — the
> project lead, decision-making, contribution paths, release process,
> and the standards-body track — see the repo-root
> [`/GOVERNANCE.md`](../../GOVERNANCE.md). The two documents are
> intentionally separate so that spec changes can be proposed and
> discussed without re-litigating project structure.

## Project governance

For the BDFL model, decision-making, release process, contribution
mechanics (DCO sign-off, branch protection, OIDC publishing), and the
W3C Community Group track, see [`/GOVERNANCE.md`](../../GOVERNANCE.md).
This file deliberately does not duplicate that content.

## Spec change process — ASP

Normative changes to the ACT specification are made via the **ACT
Spec Proposal (ASP)** process. ASPs are GitHub PRs against the
`spec/` directory using the template at
[`/spec/proposals/template.md`](../proposals/template.md). The ASP
pattern is modeled after MCP's SEP and Rust's RFC processes.

An ASP is the contributor-facing artifact for any change that touches
normative spec text. It is filed by anyone — community contributors,
maintainers, or the BDFL — proposing a change, classified for spec
versioning impact, reviewed in public, and either accepted (and
landed in a release) or withdrawn.

### Lifecycle

An ASP MUST occupy exactly one of the following states at any time:

| State | Meaning |
|---|---|
| `Draft` | The proposer is iterating on the proposal; reviewers are not yet expected to evaluate. |
| `In review` | The proposal is ready for formal review; reviewers MAY transition state. |
| `Accepted` | The BDFL has signed off; the proposal will land in the next applicable release. |
| `Implemented` | The accepted change has shipped in a tagged spec version. |
| `Deprecated` | The change introduces a deprecation; the deprecated artifact remains valid through its window. |
| `Withdrawn` | The proposer or reviewers have closed the ASP without acceptance. |

State transition rules:

- **Draft → In review.** A maintainer MAY transition once the
  proposer signals readiness. BDFL involvement is not required.
- **In review → Accepted.** The BDFL signs off explicitly. ASPs that
  propose any **breaking** change cannot reach Accepted directly; they
  promote to a superseding ASP that explicitly lists the predecessor
  (see "Versioning policy" below).
- **Accepted → Implemented.** Automatic when the corresponding spec
  edit lands in a tagged release. No separate sign-off required.
- **Any state → Withdrawn.** A maintainer or the proposer MAY
  withdraw at any time, with a one-line rationale recorded in the
  ASP's changelog.

`In review` SHOULD NOT exceed 90 days without explicit progress (a
maintainer comment, an updated draft, a BDFL response). ASPs idle past
90 days MAY be moved to Withdrawn by a maintainer with rationale; the
proposer MAY re-open by editing and re-requesting review.

### Reviewer roles

- **Proposer.** Owns the ASP document. Writes drafts, responds to
  comments, updates the document. MAY withdraw.
- **Maintainer.** MAY review and approve ASPs at the In review
  stage, MAY transition Draft → In review and any state →
  Withdrawn, MAY merge editorial edits. MUST NOT transition In
  review → Accepted without BDFL sign-off.
- **BDFL.** Final approver of all Accepted transitions. The BDFL is
  always implicitly required for any breaking-change ASP. See
  [`/GOVERNANCE.md`](../../GOVERNANCE.md) for the BDFL role.
- **Community contributors.** MAY comment, suggest changes, propose
  alternatives. Hold no acceptance authority.

### Cadence

ASP review is asynchronous. No formal meeting cadence is required
for v0.2. The BDFL response target is 14 days; silence past 30 days
does NOT auto-accept or auto-reject — the ASP remains in its current
state and the proposer MAY re-tag.

## Normative vs informative changes

The ASP process is required for **normative** changes. Editorial and
informative changes follow a lighter path.

A change is **normative** when it adds, removes, or modifies any of:

- A MUST, SHOULD, MAY, MUST NOT, or SHOULD NOT statement.
- A required or optional field on any envelope.
- A value in a closed enum (`conformance.level`, `delivery`,
  `error.code`, etc.).
- A schema constraint (regex, length bound, structural rule).
- A default behavior (e.g., the default `subtree` depth, the default
  request budget).
- A capability flag in the standard set, or its semantics.
- A status code, header, or wire MIME type.

A change is **informative** when it touches:

- Prose clarifications that do not change the meaning of normative
  language.
- Examples (added, removed, or rewritten) that illustrate already-
  normative behavior.
- Typo fixes, grammar fixes, link fixes.
- Editorial reorganization that preserves every requirement's
  meaning and ID.

Informative changes MAY be merged as plain PRs without an ASP. The
PR description SHOULD note the informative classification and cite
the affected spec doc.

When in doubt, file an ASP — the conservative-default rule applies.
A maintainer who believes a PR labeled informative actually changes
normative meaning MUST request that the contributor re-file as an ASP.

## Versioning policy

ACT spec versions follow a `MAJOR.MINOR` shape. The `act_version`
field on every envelope carries this version (e.g., `"0.2"`).

A **MINOR** bump (e.g., `0.2` → `0.3`) bundles N accepted ASPs whose
changes are additive and backward-compatible. A MINOR change MAY:

- Add an optional field to any envelope.
- Add a value to an open enum.
- Add a new capability flag to the standard set.
- Add a new node type, block type, or content shape.
- Loosen a producer obligation (a previous SHOULD becomes MAY).
- Tighten a consumer obligation in a way that producers tolerate.

A **MAJOR** bump (e.g., `0.x` → `1.0`) MAY include changes that break
previously-conformant producers or consumers. A MAJOR change MAY:

- Add a required field to any envelope.
- Remove or rename a field.
- Change a value in a closed enum.
- Tighten the ID grammar or any schema constraint that producers
  satisfied previously.
- Change the well-known path.
- Rename a MIME type.
- Promote a SHOULD to a MUST in a way producers do not satisfy
  uniformly today.

Consumers MUST tolerate unknown optional fields per the forward-
compatibility rule. Consumers MUST reject envelopes whose
`act_version` MAJOR exceeds what the consumer implements; the
rejection is bounded (no body parsing past the version string).

Cross-link: [wire-format/conformance.md](./wire-format/conformance.md)
defines the level-stability guarantees that interact with this
versioning policy. Renaming a level (`Core`, `Standard`, `Strict`) or
its wire enum value (`"core"`, `"standard"`, `"strict"`) is MAJOR.
Adding a new level value is MAJOR. Adding a requirement to an existing
level is MINOR.

### Lockstep with implementation packages

For v0.2, the spec and the first-party reference packages release in
**lockstep**: spec v0.2.0 ships alongside every `@act-spec/*` package
at version 0.2.0. After v0.2 stable the spec moves on its own track
and impl packages move independently — a v0.3 spec MAY ship with
v0.3 reference packages, but a packagepatch (`0.3.x`) does not bump
the spec.

## Naming policy

The spec's identifiers — the project name, package names, MIME types,
and the well-known path — are normative. Changes to any of them are
MAJOR per the versioning rules above.

### The mark

The project's canonical name is **"ACT"** (uppercase initialism),
expanded as **"Agent Content Tree"**. Producers and consumers MUST
use one or the other (or both) when referring to the spec; alternate
expansions (e.g., "Agent Communication Tree", "Action Content Tree")
MUST NOT be used in spec prose, package descriptions, or fixture
data. The phrase "ACT-conformant" is a factual claim about a producer
or consumer (verifiable via the validator); it is NOT a trademark
license. No formal trademark filing has been performed for v0.2.

### Package names

First-party reference implementations published under the spec
organization use the npm scope `@act-spec/`. The naming pattern is
`@act-spec/{kind}-{thing}` where `{kind}` is one of `adapter`,
`generator`, `plugin`, `runtime`, `binding`, `cli`, `validator`,
`inspector`, `mcp-server`, `mcp-bridge`, and `{thing}` is the source,
target, or framework name in lowercase ASCII. Examples:
`@act-spec/adapter-markdown`, `@act-spec/plugin-astro`,
`@act-spec/runtime-next`, `@act-spec/binding-react`,
`@act-spec/validator`.

Community packages — anything not published by the spec organization
— MAY use any name permitted by the host registry but SHOULD include
the substring `act` somewhere in the package name when claiming ACT
conformance. Community packages MUST NOT use the substrings
`act-official`, `act-spec`, or `@act-spec/` in their names — those
are reserved for first-party use to avoid implying endorsement.

### MIME types

The v0.2 MIME type family is closed. A producer serving an ACT
envelope over HTTP, or a static asset bearing an ACT envelope, MUST
use exactly one of:

| Envelope | MIME type | File extension |
|---|---|---|
| Manifest | `application/act-manifest+json` | `.act.json` |
| Index | `application/act-index+json` | `.act.json` |
| Node | `application/act-node+json` | `.act.json` |
| Subtree | `application/act-subtree+json` | `.act.json` |
| Error | `application/act-error+json` | n/a (runtime body only) |
| NDJSON index | `application/act-index+ndjson` | `.act.ndjson` |

The `+json` and `+ndjson` structured suffixes per RFC 6838 §4.2.8
MUST be preserved exactly. The `profile` MIME parameter
(`profile=static` or `profile=runtime`) applies on top of the type
string, not as part of it.

Adding a new MIME type to this family for a new envelope is MINOR;
the new type MUST follow the `application/act-{envelope}+json` (or
`+ndjson`) pattern. Renaming an existing type is MAJOR. Removing a
type is MAJOR. Producers MUST NOT define vendor-prefixed types
(`application/vnd.example.act-*`) for ACT envelopes.

### Well-known path

The well-known discovery path is `/.well-known/act.json`. Producers
MUST NOT relocate it (e.g., to `/act/manifest.json`,
`/.well-known/agent-content-tree.json`, or `/manifest.act.json`).
Changing the well-known path is MAJOR.

### Vendor and custom extensions

Vendor-specific capability tokens, metadata fields, and extension
block types MUST use a reverse-DNS namespace prefix (e.g.,
`com.example:my-feature` for capabilities,
`com.example.plugin/extension-id` for metadata keys,
`com.example:custom-block` for block types). The colon separates the
namespace prefix from the name.

Producers MAY advertise any vendor capability or emit any vendor
block type under this convention; consumers MUST tolerate unknown
vendor namespaces and MUST NOT reject envelopes solely because they
contain a vendor extension. A producer MUST NOT use a bare
unprefixed name not listed in the standard set; bare names are
reserved for the spec.

## Migration playbook

When a spec change has consumer impact — a deprecated field, a
removed endpoint, a renamed value — producers and consumers need a
disciplined transition window. The migration playbook applies to
**any** producer adopting a new spec version that affects an existing
deployment, and is referenced from individual ASPs that introduce
breaking changes.

### Three-phase migration

A producer adopting a spec change with consumer impact MUST stage the
migration in three named phases:

1. **Advertise.** The new behavior is reachable on the deployment
   alongside the existing behavior. Both surfaces serve.
2. **Validate.** The validator at [tooling.md](./tooling.md) reports
   zero errors against the new behavior at the producer's chosen
   conformance level. Warnings are advisory.
3. **Turn-down.** The deprecated behavior is removed. Turn-down MAY
   begin only after Validate.

The producer MUST NOT skip Validate. The dual-publish window — the
duration during which both behaviors are reachable — SHOULD be at
least one MINOR cycle of the producer's release cadence, or 90 days,
whichever is longer.

### Deprecation window

A spec change that deprecates an existing field, endpoint,
capability, or behavior MUST give consumers a deprecation window:

- The deprecation MUST be announced in the deprecating MINOR (or in
  a dedicated MINOR before the removing MAJOR).
- The deprecated artifact MUST remain functional through the rest of
  the current MAJOR.
- Removal is permitted at the next MAJOR earliest.

The announcement MUST be made via the spec project's standard
announcement channel (GitHub Releases plus the project's discussion
forum) at the time the deprecating MINOR ships.

### Migration paths from prior art

Producers migrating from `/llms.txt`, sitemap-only, or MCP-only
deployments to ACT follow the same Advertise → Validate → Turn-down
discipline. The legacy surface MUST remain stable through Validate;
URL coverage MUST overlap completely between the legacy surface and
the ACT index during dual-publish; the legacy surface MAY be kept
indefinitely (turn-down is OPTIONAL for low-cost discovery aids).

### Canonical example

A documentation site at `docs.example.com` migrating from `/llms.txt`
to ACT Standard:

- **Advertise (week 0).** Publish `/.well-known/act.json` with
  `conformance.level: "standard"` and `delivery: "static"`. The
  index lists every page under its existing canonical URL. The
  subtree endpoint is advertised. `/llms.txt` is updated with a
  top-of-file link to the ACT manifest. Both surfaces serve.
- **Validate (weeks 1–2).** Run `act-validate` against the deployed
  site. Iterate on findings (typically a few summary-length
  warnings, occasional ID-grammar fixes) until the report shows zero
  errors at Standard.
- **Steady state.** `/llms.txt` is kept indefinitely; turn-down is
  not required.

## Conformance

A producer or consumer declares the spec version it implements via
the `act_version` field on every envelope (producers) or via its
package metadata and runtime probe (consumers). The combination of
`act_version` and `conformance.level` is the producer's contract; the
validator is the operational definition of compliance.

A producer or consumer claiming "ACT v0.2 conformant" MUST satisfy
every MUST in this spec set at the level claimed, as verified by the
validator. The naming and migration rules above are part of the
contract: a producer that uses the wrong MIME type or relocates the
well-known path is non-conformant, even when its envelope payloads
schema-validate cleanly.

## Examples

### A MINOR ASP that lands as an in-place edit

A community contributor proposes adding a new value `"distillation"`
to the open `summary_source` enum on node envelopes. The change is
classified MINOR (additive value to an open enum). A maintainer
transitions the ASP to `In review`; the BDFL approves within 14 days.
The PR edits [wire-format/node.md](./wire-format/node.md) to add the
new value to the documented set, updates the schema's enum suggestion
list, adds a positive fixture exercising the new value, and bumps the
spec version's MINOR in the next release. The ASP transitions to
`Implemented` when the release ships.

### A breaking ASP that promotes to a superseding spec version

A partner platform proposes converting the closed `error.code` enum
to an open enum to accommodate platform-specific codes. The change is
classified MAJOR (closed → open is a semantic-breaking change). The
ASP cannot reach `Accepted` directly; the proposer drafts a
superseding ASP that explicitly lists the predecessor. The
superseding ASP is reviewed; on acceptance the predecessor's
deprecation notice ships in the next MINOR, and the new behavior
ships in v1.0. The closed enum remains valid throughout the v0.x
deprecation window.

### A deprecation ASP

An ASP proposes deprecating the `policy.contact` field on the
manifest in favor of `site.contact_url`. The change is MINOR (the
field becomes deprecated; nothing breaks). The ASP cites the
deprecation window: announce in v0.3, remove at v1.0 earliest. The
edit lands in v0.3; the field continues to validate cleanly through
v0.x. The ASP transitions to `Deprecated` (the lifecycle state, not
the field's status — note the same word).

### A withdrawn ASP

A contributor proposes renaming `act_version` to `spec_version`. The
change is MAJOR (rename of required field) but provides no functional
benefit. A maintainer marks the ASP `Withdrawn` with rationale "no
measurable benefit; bikeshed." The ASP remains in the repository for
historical reference.

### A conflict escalation

A maintainer thinks a proposed change is MINOR; the BDFL believes it
is MAJOR. The conservative-default rule applies: the change is
treated as MAJOR (promotion required). The maintainer's argument is
recorded in the ASP's discussion thread; the BDFL's classification is
final.

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |
