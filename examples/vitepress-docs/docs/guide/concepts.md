---
id: guide/concepts
title: Core Concepts
summary: Workspaces, buckets, objects, and tokens — the four nouns Tinybox APIs operate on.
type: explanation
parent: root
locale: en-US
related:
  - guide/getting-started
  - reference/api
---

# Core Concepts

Tinybox APIs operate on four nouns. Internalize these before writing
production code.

## Workspaces

A **workspace** is the top-level isolation boundary. Each workspace owns
its own buckets, tokens, billing, and rate-limit budget. A user may belong
to many workspaces; a token belongs to exactly one.

## Buckets

A **bucket** is a flat namespace of objects scoped to a workspace. Bucket
names are unique within a workspace and must be DNS-safe.

## Objects

An **object** is an opaque blob plus user-defined metadata. Objects are
immutable once written; updates are modeled as a new version.

## Tokens

A **token** is an opaque bearer credential bound to a workspace. Tokens
carry a scope (`read`, `write`, `admin`) and an optional expiry.

> [!NOTE]
> Tokens never traverse Tinybox's logging pipeline. If you suspect
> compromise, rotate immediately from the dashboard — there is no
> recoverable form on the server side.
