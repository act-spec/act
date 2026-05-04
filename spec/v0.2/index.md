---
title: ACT Specification v0.2.0
spec: act-spec
spec-version: 0.2.0
status: Draft
last-updated: 2026-05-03
---

# ACT Specification v0.2.0

## Status of this document

This is a Draft of ACT v0.2.0, working toward a 0.2.0 stable release.
v0.2 is the first public release of the Agent Content Tree
specification. The normative text in this document set has been drafted
by the project lead from the source design archive; subsequent
modifications follow the ACT Spec Proposal (ASP) process described
under "Change process" below.

The Draft status indicates that the spec text is not yet final for the
0.2.0 line. Implementations targeting 0.2.0-rc.x SHOULD track this
document; implementations targeting 0.2.0 stable MUST track the version
of this document tagged at that release.

## Editors

- Jeremy Forsythe (BDFL)

## License

- Spec text: [CC-BY-4.0](../../LICENSE-spec)
- Reference implementations: [Apache-2.0](../../LICENSE)

The spec text and the reference implementations are licensed
separately so that downstream adopters can vendor the implementations
under permissive terms while the spec text remains a freely
redistributable normative document.

## Abstract

The Agent Content Tree (ACT) is an open standard for publishing
structured, AI-discoverable content from any website, CMS, or
application. ACT defines a JSON wire format consisting of a manifest
(the discovery document at `/.well-known/act.json`), an index of
nodes, and per-node JSON payloads carrying typed prose blocks and
optional component references. Producers declare a conformance level —
Core, Standard, or Strict — that binds the producer to a known set of
required fields, block types, and HTTP semantics; consumers negotiate
on level and on a fine-grained capabilities surface.

ACT addresses a different problem than `/llms.txt` and
`/llms-full.txt`. Where those formats publish a flat navigation pointer
or a single-file content dump, ACT publishes a typed, walkable JSON
tree that an agent can selectively retrieve, subtree-skip via ETags,
and revalidate efficiently. ACT is additive to the prior art:
ACT-emitting sites SHOULD auto-emit `/llms.txt` and `/llms-full.txt`
for back-compat. ACT does not replace `schema.org` (in-page semantics),
`sitemap.xml` (URL enumeration), or MCP (transport); it provides the
structured-data shape that those mechanisms can reference, ingest, or
surface.

The wire-format documents under [./wire-format/](./wire-format/) are
**normative**. The adapter, generator, runtime, and tooling documents
under their respective directories describe the reference TypeScript
implementations and the spec-only mappings for non-TS targets; they
are normative for those targets and informative as reference patterns.

## Conventions

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**,
**SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**,
and **OPTIONAL** in this document are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and clarified by
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174), and only when they
appear in ALL CAPITALS. Lowercase "must," "should," and "may" carry no
normative weight.

JSON Schemas referenced from this document set live under
[`schemas/`](../../schemas/). Schema paths are cited as
`schemas/<NNN>/<name>.schema.json`. The schema files are authoritative
where prose and schema disagree; reproductions inline in spec text are
for reading convenience.

Examples use `https://example.com`, `https://docs.example.com`, and
similar realistic-but-neutral domain names. JSON snippets are
illustrative; they are not part of the normative contract unless the
prose explicitly cites them.

## Document set

### Wire format (normative)

| Document | Topic |
|---|---|
| [Manifest](./wire-format/manifest.md) | The `/.well-known/act.json` discovery document. |
| [Index](./wire-format/index.md) | The tree-of-contents document at `index_url`. |
| [Node](./wire-format/node.md) | Per-node JSON, prose blocks, subtree envelope. |
| [Capabilities](./wire-format/capabilities.md) | The `capabilities` object on the manifest. |
| [Conformance](./wire-format/conformance.md) | Core / Standard / Strict level definitions. |
| [ETag](./wire-format/etag.md) | Strong-validator ETag derivation and HTTP semantics. |
| [Security](./wire-format/security.md) | Threat model, transport, authentication, sanitization. |

### Adapters (per-source contracts)

| Adapter | Document |
|---|---|
| Markdown | [adapters/markdown.md](./adapters/markdown.md) |
| Contentful | [adapters/contentful.md](./adapters/contentful.md) |
| Sanity | [adapters/sanity.md](./adapters/sanity.md) |
| Storyblok | [adapters/storyblok.md](./adapters/storyblok.md) |
| Strapi | [adapters/strapi.md](./adapters/strapi.md) |
| Builder.io | [adapters/builder.md](./adapters/builder.md) |
| WordPress | [adapters/wordpress.md](./adapters/wordpress.md) |
| Notion | [adapters/notion.md](./adapters/notion.md) |
| i18n | [adapters/i18n.md](./adapters/i18n.md) |
| Programmatic | [adapters/programmatic.md](./adapters/programmatic.md) |
| Hugo (spec-only) | [adapters/hugo.md](./adapters/hugo.md) |
| MkDocs (spec-only) | [adapters/mkdocs.md](./adapters/mkdocs.md) |
| Jekyll (spec-only) | [adapters/jekyll.md](./adapters/jekyll.md) |

### Components

| Document | Topic |
|---|---|
| [Component contract](./components.md) | React, Vue, Angular bindings. |

### Generators (per-framework integrations)

| Generator | Document |
|---|---|
| Astro | [generators/astro.md](./generators/astro.md) |
| Docusaurus | [generators/docusaurus.md](./generators/docusaurus.md) |
| Next.js | [generators/nextjs.md](./generators/nextjs.md) |
| Nuxt | [generators/nuxt.md](./generators/nuxt.md) |
| Remix | [generators/remix.md](./generators/remix.md) |
| Eleventy | [generators/eleventy.md](./generators/eleventy.md) |
| VitePress | [generators/vitepress.md](./generators/vitepress.md) |

### Delivery and tooling

| Document | Topic |
|---|---|
| [Runtime SDK](./runtime.md) | Runtime delivery contract. |
| [Tooling](./tooling.md) | Validator, inspector, MCP bridge. |

### Process and positioning

| Document | Topic |
|---|---|
| [Governance](./governance.md) | Spec change process and project governance. |
| [Why ACT](./why-act.md) | Comparison with adjacent formats. |

## Conformance

This document defines three conformance levels — **Core**, **Standard**,
and **Strict** — fully specified in
[wire-format/conformance.md](./wire-format/conformance.md). The level
names and the wire enum values (`"core"`, `"standard"`, `"strict"`) are
stable across the v0.2.x line. Adding a fourth value to the level enum
is a MAJOR change; renaming any level is MAJOR.

Producers declare their target level in the manifest's
`conformance.level` field. Consumers negotiate on declared level and on
the manifest's `capabilities` object (see
[wire-format/capabilities.md](./wire-format/capabilities.md)). The
reference validator at `@act-spec/validator` operationalizes the level
contract; every conformant publisher MUST validate clean against the
validator at the declared level.

## Change process

Normative changes to this specification are made via the ACT Spec
Proposal (ASP) process. The ASP template and the index of accepted,
rejected, and in-flight proposals live at
[/spec/proposals/](../proposals/). The process mirrors Rust's RFC and
MCP's SEP patterns: a proposal is filed as a PR against
`spec/proposals/`; discussion proceeds in the PR; the BDFL accepts or
rejects with rationale; accepted proposals are merged and their
normative content is folded into the relevant spec documents under
`spec/v<major>.<minor>/` in a follow-up PR.

Informative changes (spelling, formatting, additional examples, link
fixes) MAY be made via plain PR without an ASP.

The full governance contract — decision-making, contribution paths,
maintainership, foundation track — is at
[GOVERNANCE.md](../../GOVERNANCE.md).

## Versioning

Specification versions follow `MAJOR.MINOR.PATCH` semantics:

- **MAJOR** — backward-incompatible changes. Examples: removing a
  required field, changing a closed enum's value set, tightening the
  ID grammar, renaming a conformance level.
- **MINOR** — backward-compatible additions. Examples: adding an
  optional field, adding a value to an open enum, adding a new
  capability key.
- **PATCH** — clarifications and editorial fixes that do not change
  the contract.

The wire format declares its target spec version via the
`act_version` field on every envelope. The value matches the regex
`^[0-9]+\.[0-9]+$` — no PATCH segment on the wire — because PATCH
revisions are editorial-only and consumers do not branch on them.

For v0.2.x, the spec version and every reference TypeScript package
under `@act-spec/*` ship in lockstep at version `0.2.x`. After v0.2.0
stable, the spec version moves on its own track and implementation
package versions move independently. Implementation packages MAY
support older spec versions (a 0.3.x package SHOULD continue to
parse 0.2.x envelopes); the spec defines forward-compatibility
requirements (consumers MUST tolerate unknown optional fields,
unknown values under open enums, and unknown capability keys).

---

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial spec drafted by BDFL |

---

**Sources:** prd/000-INDEX.md, prd/000-template.md, prd/000-decisions-needed.md, prd/000-gaps-and-resolutions.md, prd/000-governance.md, prd/108-versioning-policy.md
