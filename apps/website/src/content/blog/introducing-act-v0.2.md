---
title: Introducing ACT v0.2
description: The first public release of the Agent Content Tree spec, reference implementations, hosted MCP server, and homepage.
pubDate: 2026-06-01
author: Jeremy Forsythe
draft: true
---

> Placeholder. Final post written at the v0.2.0 stable cut. Outline below.

## What we're shipping

ACT (Agent Content Tree) v0.2 is the first public release of the spec and the
reference implementations. This post will cover:

- What ACT is and what problem it solves
- How it relates to `/llms.txt`, `/llms-full.txt`, schema.org, sitemap.xml,
  and MCP
- The hosted MCP server at `mcp.act-spec.org` — the GTM bridge
- TypeScript and Go reference impls, conformance fixtures, validator
- How to drop ACT into an existing site, or scaffold a new one
- Governance: BDFL + ASP process, W3C Community Group filing
- Acknowledgments: reference adopters, early reviewers, and the prior art
  ACT builds on

## Getting started

See the [Quickstart](/quickstart/) for one-line plugin snippets and the
[examples gallery](/examples/) for runnable starter sites. Spec text lives
under [`/spec/v0.2/`](/spec/v0.2/).
