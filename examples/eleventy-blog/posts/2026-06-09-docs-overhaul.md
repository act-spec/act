---
title: Docs overhaul — the public site is now agent-readable
summary: The new docs site exposes the ACT (Agent Content Tree) protocol per PRD-100 so agents can discover and traverse the documentation without scraping HTML.
date: 2026-06-09
type: post
parent: posts
tags:
  - docs
  - act
---

The docs overhaul went live this morning. The headline change is
visual; the deeper change is that every documentation page now
carries an ACT (Agent Content Tree) envelope per PRD-100, served
under `/.well-known/act.json` plus the index and node files.

## What this enables

Agents — including LLM-powered support copilots and developer
tooling — can discover the docs through a single manifest fetch
rather than scraping HTML. The discovery cost drops from a recursive
crawl to a constant fetch.

## What this does not do

ACT is a discoverability protocol, not a delivery protocol. The HTML
docs continue to render exactly as before; the ACT envelopes are
emitted as a byte-stable sidecar.
