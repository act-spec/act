---
title: The CLI rewrite is finally happening
summary: A pre-announcement that the CLI rewrite is funded, staffed, and starting in July with a target ship date of late October.
date: 2026-06-16
type: post
parent: posts
tags:
  - tools
  - cli
---

The CLI rewrite is finally happening. Two engineers start on it in
July; the target ship date is the last week of October. We are
pre-announcing now so customers using the current CLI in CI
pipelines can plan their migration.

## Compatibility

The new CLI is a drop-in replacement for the v1 surface. Every v1
command name and flag is preserved; behavior changes are limited to
output formatting on three commands (the `list`, `get`, and `tail`
families).

## What is new

Streaming output for long-running operations, a built-in `--watch`
mode for the `tail` family, native shell completions for the four
shells we test against, and a single static binary per platform.
