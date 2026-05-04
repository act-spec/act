---
title: Why ACT
spec: act-spec
spec-version: 0.2.0
status: Stable
last-updated: 2026-05-03
---

# Why ACT

## TL;DR

ACT (Agent Content Tree) is a structured-content format for AI agents. It is a
strict superset of [`/llms.txt`](https://llmstxt.org/) and
[`/llms-full.txt`](https://llmstxt.org/) — every ACT plugin auto-emits both
files for back-compat, so adopting ACT does not break tools that read the flat
formats today. ACT adds typed nodes, hierarchy, native i18n, schema validation,
runtime-or-static delivery, and component-level extraction. The hosted MCP
server at `mcp.act-spec.org` lets any MCP-capable agent (Claude Desktop,
Cursor, Continue, and any other client) browse any ACT-emitting site
immediately, without waiting for AI vendors to ship native
`.well-known/act.json` support. ACT is the next layer for sites that have
outgrown a flat file.

## The problem

A developer wants to expose a docs site, a CMS, or a product surface to AI
agents. The existing options each solve part of the problem:

- **Scraping the rendered HTML.** Fragile, expensive, and the
  terms-of-service landscape is asymmetric across hosts and crawlers. Layout
  changes silently break consumers. Authenticated and runtime-rendered content
  is invisible.
- **[schema.org](https://schema.org/) JSON-LD.** In-page semantic
  annotations on individual HTML elements. Strong for SEO and rich snippets,
  but it is not a content tree — agents still need to crawl page-by-page and
  reconcile per-element annotations.
- **[sitemap.xml](https://sitemaps.org/).** A list of URLs with freshness
  hints. No content. No structure. No localisation beyond `hreflang`. A
  crawling input, not an ingestion output.
- **[`/llms.txt`](https://llmstxt.org/).** A single file at the site root
  with bullet links and one-line descriptions of important resources.
  Excellent for a small site that fits in a single mental load. Loses
  hierarchy and types as the site grows.
- **[`/llms-full.txt`](https://llmstxt.org/).** A single file containing
  every page of the site concatenated, sized to fit one LLM context window.
  Excellent for tools that ingest a whole project at once. Loses hierarchy,
  per-locale structure, and runs into a size ceiling on large sites.
- **[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) servers,
  hand-written.** Each server defines its own tools and data shapes. No
  standard contract for content shape, so each consumer-publisher pair is
  bespoke.
- **Custom REST endpoints per consumer.** High maintenance, fragmented, no
  shared schema. Every new consumer means a new contract.

None of these are wrong. Each has a use case where it is the correct
tool. ACT is positioned as the next layer when those tools begin to lose
fidelity.

## What ACT adds

- **Typed nodes.** Every resource has a type — `Article`, `ApiEndpoint`,
  `Concept`, `Section`, `Recipe`, and so on — so agents reason about shape,
  not just text.
- **Hierarchy.** Parent/child links, subtrees, and cross-references give
  agents a content graph they can walk.
- **Native i18n.** Locale is a first-class field. Per-locale URLs and
  fallback chains are part of the wire format.
- **Schema-validated wire format.** Every node validates against a
  published JSON Schema. Conformance levels (Core, Standard, Strict) make
  compatibility testable instead of folkloric.
- **Runtime-or-static modes.** Small sites publish static JSON files
  alongside their normal output. Large or authenticated sites expose a
  runtime API. The wire format is the same in both modes.
- **Component-level extraction.** Typed components in pages — callouts,
  code samples, tables, parameter lists — survive the round-trip. Agents see
  structure, not flattened HTML.
- **Discovery.** A single bookmark per site at `.well-known/act.json`. A
  deterministic walk from there. ETag-aware fetches.

## Comparison table

| Dimension | `/llms.txt` | `/llms-full.txt` | schema.org | sitemap.xml | MCP (alone) | ACT |
|---|---|---|---|---|---|---|
| Format | Single file | Single file | Per-element annotations | Single XML index | Per-server tools | Tree of typed nodes |
| Discovery | Single URL | Single URL | Per-page (parse HTML) | Single URL | Per-server config | Single URL (`.well-known/act.json`) |
| Typed nodes | No | No | Yes (per element) | No | No | Yes |
| Hierarchy | No (flat list) | Implicit (concatenation order) | No | Hint (priority) | No | Yes |
| i18n | No | No | Partial (per-element `inLanguage`) | `hreflang` hint | No | Yes (first-class) |
| Schema validation | No | No | Yes (vocabularies) | Weak (XSD) | Yes (per-tool JSON Schema) | Yes (every node) |
| Runtime mode | No | No | No | No | Yes | Yes |
| Component extraction | No | No | Partial | No | No | Yes |
| Size ceiling | Small (one screen) | Medium (one context window) | Per-page | Per-URL | Unbounded | Unbounded (subtree fetches) |
| AI-agent-ready today | Yes | Yes | No (needs scraper) | No (URLs only) | Yes (with server) | Yes (via hosted MCP) |
| Use case | Tiny static site index | Whole-project dump | SEO + rich snippets | Crawler hint | Bespoke tool I/O | Structured content for agents |

## Compared to `/llms.txt`

[`/llms.txt`](https://llmstxt.org/) is a navigation pointer: a single file
at the site root listing important resources with one-line summaries. It is
the right tool for a static site that fits comfortably in a single screen,
where the whole point is "here are the things; pick one." It is small, it is
human-readable, and it is supported by a growing list of tools today.

ACT plugins auto-emit `/llms.txt` so adopting ACT means an `/llms.txt` comes
free — no flag-day for tools that read the flat format today. What ACT adds
on top is type information, hierarchy, native i18n, and schema validation.
When a site outgrows a flat list — when there are sections inside sections,
multiple locales, programmatic content from a CMS, or hundreds of pages — ACT
is the next layer up. Until then, `/llms.txt` is fine on its own.

## Compared to `/llms-full.txt`

[`/llms-full.txt`](https://llmstxt.org/) is a content dump: every page of
the site concatenated with its frontmatter, sized to fit a single LLM context
window. It is the right tool for AI tools that ingest a whole project at once
— Cursor's index is the canonical example — and for users who prefer a "give
me everything in one file" interaction.

ACT plugins auto-emit `/llms-full.txt` (with a configurable size limit per
plugin). What ACT adds is the ability for an agent to fetch only the subtree
it needs. On a 5,000-page docs site, an agent does not need to load the whole
file to answer a question about one API endpoint. ACT subtree fetches are
bounded; a flat dump is not. The two formats coexist: `/llms-full.txt` for
batch ingestion, ACT for targeted walks. The CLI subcommand
`actree flatten <url>` produces an `/llms-full.txt`-style render of any ACT
site, on demand.

## Compared to schema.org / JSON-LD

[schema.org](https://schema.org/) is in-page semantic markup: structured
annotations on HTML elements (or as a JSON-LD block in `<head>`). It is
optimised for search engines and rich snippets. ACT is an out-of-band
content tree: a separate JSON resource at a known URL, designed for agent
ingestion. They solve different problems and compose well: an ACT node MAY
embed schema.org JSON-LD for the rendered page in its `metadata` block. Use
schema.org for SEO; use ACT for structured agent ingestion. Adopting one
does not preclude the other.

## Compared to sitemap.xml

[sitemap.xml](https://sitemaps.org/) gives URLs; ACT gives content.
sitemap.xml is a hint to crawlers about freshness and priority, designed to
make crawling more efficient. ACT is the content itself, in agent-readable
form, designed to make crawling unnecessary. They compose: a sitemap.xml MAY
reference your ACT manifest URL as one of its entries, so a crawler that
follows sitemap.xml discovers ACT and switches to structured ingestion.

## Compared to MCP alone

[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) is a
transport for agent-to-tool I/O. Each MCP server defines its own tools and
data shapes. ACT is a data shape. The two compose: ACT defines the structure
of a site's content; MCP is one way agents read that structure. ACT ships
`@act-spec/mcp-server`, which exposes any ACT-emitting site to any
MCP-capable agent through a stable set of tools (`act_load_site`,
`act_walk_subtree`, `act_search`, `act_get_node`).

You can use ACT without MCP — for example, in a browser SDK that walks the
tree directly — and you can use MCP without ACT (most existing MCP servers
do their own thing). The combination is what unlocks the
chicken-and-egg break: ACT-emitting sites become immediately useful to
Claude Desktop, Cursor, Continue, and any other MCP-capable agent through
the hosted instance at `mcp.act-spec.org`. No vendor work required on
either side. Self-host the same server inside your own infrastructure when
you need to.

## Interop story — auto-emit `/llms.txt` and `/llms-full.txt`

Every ACT plugin emits `/llms.txt` and `/llms-full.txt` by default
(configurable per-plugin opt-out). Adopting ACT does not break tools that
read either flat format today. The CLI subcommand `actree flatten <url>`
produces an `/llms-full.txt`-style render of any ACT site, on demand, so
existing pipelines that consume the flat dump keep working. The default-on
emit is deliberate: ACT is positioned as a strict superset, and the easiest
way to demonstrate that is to ship the prior-art files in the box.

## When to choose ACT vs each alternative

A concrete decision matrix:

- **Tiny static site (under ~10 pages, single locale).** `/llms.txt` is
  fine on its own. ACT adds little. If you are using a framework with an ACT
  plugin already, emitting both costs nothing — but a hand-written
  `/llms.txt` is a perfectly reasonable answer.
- **Medium docs or product site (~10–200 pages, single locale).** ACT is
  recommended. A flat list starts to lose useful structure at this size.
  `/llms.txt` comes free with the plugin; agents that want to walk the tree
  per-section can do so.
- **Large or multilingual site (200+ pages, multiple locales).** ACT
  clearly wins. Flat formats lose too much structure and hit size ceilings.
  Per-locale subtrees and ETag-aware fetches matter.
- **Headless CMS or programmatic content.** ACT, using the programmatic
  adapter (`@act-spec/adapter-wordpress`, `@act-spec/adapter-notion`, or a
  custom adapter built on `@act-spec/core`).
- **Real-time or authenticated content.** ACT runtime mode (Strict
  conformance level). Runtime mode publishes the same wire format from a
  live API instead of static files.
- **High-frequency-update sites (e.g., changelog feeds, status pages).**
  ACT runtime mode with ETag handling. Static emit is fine for daily
  rebuilds; runtime is the better fit when content changes between builds.
- **You only care about SEO.** schema.org and a sitemap.xml. ACT is for
  agent ingestion, not for search ranking.
- **You only need a single file an LLM can swallow whole.** `/llms-full.txt`
  on its own is fine. ACT is overhead if no consumer will ever walk the
  tree.

## Migration paths

- **From `/llms.txt`.** Drop in the framework plugin
  (`@act-spec/plugin-astro`, `@act-spec/plugin-nextjs`,
  `@act-spec/plugin-vitepress`, etc.). The plugin emits `.well-known/act.json`
  and the typed tree alongside the auto-generated `/llms.txt`. Keep your
  hand-written `/llms.txt` instead, by setting the plugin opt-out — both
  paths are supported.
- **From schema.org.** Keep your JSON-LD. Add ACT as a separate channel.
  Optionally, embed your existing JSON-LD in each ACT node's `metadata`
  block so consumers that want it can find it without re-extracting it from
  HTML.
- **From a custom JSON endpoint.** Adopt ACT's wire format for the response
  shape. Keep your endpoints behind the manifest as a runtime mode (Strict
  conformance). Most custom endpoints map to ACT nodes with little
  rewriting; the hard work is usually labelling your existing types against
  the ACT type vocabulary.
- **From a hand-written MCP server.** Continue running it. Add an
  `@act-spec/mcp-server` instance pointed at your ACT manifest for the
  generic walk/search/load interface. Keep the bespoke tools alongside.

## Further reading

- [`/llms.txt` and `/llms-full.txt`](https://llmstxt.org/)
- [schema.org](https://schema.org/)
- [sitemap.xml](https://sitemaps.org/)
- [Model Context Protocol](https://modelcontextprotocol.io/)

---

## Changelog

| Date | Version | Notes |
|---|---|---|
| 2026-05-03 | 0.2.0 | Initial positioning prose |
