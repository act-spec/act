---
title: Why ACT
description: How ACT compares to llms.txt, llms-full.txt, schema.org, sitemap.xml, and MCP — and when to choose each.
summary: ACT is a strict superset of llms.txt and llms-full.txt; complementary to schema.org, sitemap.xml, and MCP. Adds typed nodes, hierarchy, i18n, schema validation, runtime delivery.
type: concept
---

> The full canonical comparison lives in the
> [v0.2 spec](/spec/v0.2/why-act/). This page is the marketing-front summary
> with the same conclusions.

## TL;DR

- **vs `/llms.txt` and `/llms-full.txt`** — ACT plugins auto-emit both files
  for back-compat. ACT adds typed nodes, hierarchy, i18n, schema validation,
  runtime delivery. Migration from llms.txt is zero-effort.
- **vs schema.org** — different layer. schema.org is in-page semantics for
  individual elements; ACT is an out-of-band content tree. They compose.
- **vs sitemap.xml** — sitemap is a URL list; ACT carries the actual content.
- **vs MCP alone** — ACT defines the data shape; MCP is one transport. We
  ship a hosted MCP server (`mcp.act-spec.org`) so any MCP-capable agent
  can read any ACT-emitting site immediately.
- **vs custom REST endpoints** — ACT is the shared schema everyone agrees on.

## When to choose ACT

Choose ACT when:

- Your site is large enough that llms.txt loses fidelity (more than ~50 pages
  or any non-trivial hierarchy).
- You serve content in more than one locale and need first-class i18n.
- You want schema-validated, conformance-testable content that consumers can
  rely on without bespoke onboarding.
- You publish to AI agents and want it to work *today* via MCP, not "when
  vendors ship native support."
- You have runtime-rendered or per-tenant content the static formats cannot
  carry.

Stick with the simpler tools when:

- A single static llms.txt is sufficient (small, single-locale, no
  hierarchy).
- You only need search-engine SEO snippets — schema.org is the right layer.
- You only need to advertise URLs — sitemap.xml is enough.

## Migration paths

If you ship `/llms.txt` today, dropping in any ACT plugin keeps the file
emitting (default-on) while adding the structured tree. Existing llms.txt
consumers see no change.

If you ship a hand-written MCP server, ACT lets you delete most of the
custom data-shape code and reuse the standard. See
[hybrid-static-runtime-mcp](https://github.com/act-spec/act/tree/main/examples/hybrid-static-runtime-mcp).

## The hosted MCP

The single biggest reason to adopt ACT in v0.2 is the hosted MCP server.
Every ACT-emitting site is immediately usable by any MCP-capable agent —
Claude Desktop, Cursor, Continue, anything that speaks MCP.

See the [homepage](/#try-act-with-your-ai-agent) for the copy-paste client
config and the [tooling spec](/spec/v0.2/tooling/) for transport details.

## Read the full comparison

The detailed comparison table, prose, and conformance-band trade-offs live in
the [v0.2 spec — Why ACT](/spec/v0.2/why-act/).
