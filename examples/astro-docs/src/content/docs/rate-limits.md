---
title: Rate limits
summary: Tinybox publishes rate-limit headers on every response and returns 429 when the bucket is exhausted.
type: reference
parent: root
related:
  - errors
---

# Rate limits

Each workspace has a per-second request budget. Tinybox returns the
following headers on every response:

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | Total requests/sec budget. |
| `X-RateLimit-Remaining` | Requests left in the current window. |
| `X-RateLimit-Reset` | Unix timestamp when the bucket refills. |

When a request exceeds the budget Tinybox returns `429 rate_limited` with a
`Retry-After` header in seconds. The standard error envelope (see
[Errors](./errors.md)) is included.

> [!TIP]
> Use the `X-RateLimit-Remaining` header to backpressure proactively.
> Don't wait for a 429 — slow down at 10% remaining.
