---
id: root
title: Tinybox API Documentation
summary: REST API for the Tinybox storage service — quickstart, authentication, and full endpoint reference.
type: index
children:
  - quickstart
  - auth
  - endpoints
  - errors
  - rate-limits
  - webhooks
  - pagination
---

# Tinybox API

Tinybox is a small object-storage service. The API is REST over HTTPS and
returns JSON. This documentation site is the canonical PRD-700 reference
example for the ACT (Agent Content Tree) v0.1 specification.

## What you get

- Predictable, paginated endpoints for objects and buckets.
- Bearer-token authentication scoped to a single workspace.
- Stable rate-limit headers and idempotent retries.

> [!NOTE]
> This is a fictional API used purely as PRD-700's worked example. Do not
> point real client code at `api.tinybox.dev`.

Read [Quickstart](./quickstart.md) to send your first request, then
[Authentication](./auth.md) to mint a workspace token.
